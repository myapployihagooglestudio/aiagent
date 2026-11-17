import {
  APP_RPM_SAFETY_NOTE,
  isLegacyQuotaRiskModel,
  isModelCompatibleWithTask,
  validateAndLoadGeminiConfig,
  type ValidatedGeminiConfig,
} from './modelConfig.ts';

export type GeminiTaskType = 'reply' | 'intent' | 'search' | 'qc' | 'stt' | 'tts';

export type GeminiErrorKind =
  | 'daily_quota_exhausted'
  | 'rate_limit_rpm'
  | 'transient_5xx'
  | 'thinking_unsupported'
  | 'auth_or_config'
  | 'unknown';

export interface ClassifiedGeminiError {
  kind: GeminiErrorKind;
  statusCode?: number;
  retryAfterMs?: number;
  message: string;
}

export class QuotaUnavailableError extends Error {
  public readonly retryAfterMs: number;
  public readonly model: string;
  public readonly kind: GeminiErrorKind;

  constructor(model: string, retryAfterMs: number, kind: GeminiErrorKind, message: string) {
    super(message);
    this.name = 'QuotaUnavailableError';
    this.model = model;
    this.retryAfterMs = retryAfterMs;
    this.kind = kind;
  }
}

export interface ModelUsageCounter {
  requests: number;
  successes: number;
  rateLimits429: number;
  dailyExhausted429: number;
  errors: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  circuitState: 'closed' | 'open' | 'half_open';
  cooldownUntil: string | null;
  lastError: string | null;
}

interface CircuitEntry {
  state: 'closed' | 'open' | 'half_open';
  cooldownUntilMs: number;
  consecutive429: number;
  halfOpenInFlight: boolean;
  lastError: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractRetryAfterMs(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);

  // Google RPC RetryInfo often prints `"retryDelay":"14s"` or `retry in 14.5s`
  const secMatch =
    msg.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i) ||
    msg.match(/retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
  if (secMatch) {
    const val = Math.ceil(Number(secMatch[1]) * 1000);
    if (Number.isFinite(val) && val > 0) return Math.min(val, 3_600_000);
  }

  const msMatch = msg.match(/retryDelay["']?\s*[:=]\s*["']?(\d+)ms/i);
  if (msMatch) {
    const val = Number(msMatch[1]);
    if (Number.isFinite(val) && val > 0) return Math.min(val, 3_600_000);
  }

  if (err && typeof err === 'object') {
    const rec = err as { headers?: Record<string, string>; status?: number };
    const hdr = rec.headers?.['retry-after'] || rec.headers?.['Retry-After'];
    if (hdr && /^\d+$/.test(hdr.trim())) {
      return Math.min(Number(hdr.trim()) * 1000, 3_600_000);
    }
  }
  return undefined;
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const statusRaw =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const statusCode = Number.isFinite(statusRaw) ? statusRaw : undefined;
  const retryAfterMs = extractRetryAfterMs(err);

  const is429 =
    statusCode === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests');

  if (is429) {
    const isDaily =
      lower.includes('perday') ||
      lower.includes('per_day') ||
      lower.includes('per day') ||
      lower.includes('daily') ||
      lower.includes('limit: 0') ||
      lower.includes('generaterequestsperday');
    return {
      kind: isDaily ? 'daily_quota_exhausted' : 'rate_limit_rpm',
      statusCode: 429,
      retryAfterMs,
      message,
    };
  }

  if (
    statusCode === 400 &&
    (lower.includes('thinking') || lower.includes('thinkinglevel') || lower.includes('thinkingbudget'))
  ) {
    return { kind: 'thinking_unsupported', statusCode: 400, message };
  }

  if (
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 404 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('not_found')
  ) {
    return { kind: 'auth_or_config', statusCode, message };
  }

  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    lower.includes('unavailable') ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed')
  ) {
    return { kind: 'transient_5xx', statusCode, retryAfterMs, message };
  }

  return { kind: 'unknown', statusCode, retryAfterMs, message };
}

export class GeminiQuotaManager {
  private activeCount = 0;
  private waitQueue: Array<() => void> = [];
  private requestTimestamps: number[] = [];
  private circuits = new Map<string, CircuitEntry>();
  private usageByModel = new Map<string, ModelUsageCounter>();
  private usageByTask = new Map<
    GeminiTaskType,
    { requests: number; successes: number; errors: number; totalTokens: number }
  >();
  private dedupInFlight = new Map<string, Promise<unknown>>();
  public readonly thinkingUnsupportedModels = new Set<string>();
  private dedupHits = 0;
  private validatedConfig: ValidatedGeminiConfig | null = null;
  private verifiedFallbackModels = new Map<string, boolean>();

  public loadAndValidateStartupConfig(): ValidatedGeminiConfig {
    this.validatedConfig = validateAndLoadGeminiConfig();
    return this.validatedConfig;
  }

  public getRuntimeConfig(): ValidatedGeminiConfig {
    return validateAndLoadGeminiConfig();
  }

  public async verifyConfiguredFallbackModel(
    verifier: (modelId: string) => Promise<boolean>
  ): Promise<boolean> {
    const cfg = this.getRuntimeConfig();
    if (!cfg.fallbackModel) return false;
    try {
      const ok = await verifier(cfg.fallbackModel);
      this.verifiedFallbackModels.set(cfg.fallbackModel, ok);
      return ok;
    } catch {
      this.verifiedFallbackModels.set(cfg.fallbackModel, false);
      return false;
    }
  }

  public isFallbackAllowed(fallbackModel: string | null): boolean {
    if (!fallbackModel) return false;
    const explicitCheck = this.verifiedFallbackModels.get(fallbackModel);
    if (explicitCheck === false) return false;
    if (isLegacyQuotaRiskModel(fallbackModel) && explicitCheck !== true) {
      return false;
    }
    return true;
  }

  private getMaxConcurrency(): number {
    return this.getRuntimeConfig().maxConcurrency;
  }

  private getRpmLimit(): number {
    return this.getRuntimeConfig().rpmLimit;
  }

  private getOrCreateUsage(model: string): ModelUsageCounter {
    let entry = this.usageByModel.get(model);
    if (!entry) {
      entry = {
        requests: 0,
        successes: 0,
        rateLimits429: 0,
        dailyExhausted429: 0,
        errors: 0,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        circuitState: 'closed',
        cooldownUntil: null,
        lastError: null,
      };
      this.usageByModel.set(model, entry);
    }
    return entry;
  }

  private getOrCreateCircuit(model: string): CircuitEntry {
    let c = this.circuits.get(model);
    if (!c) {
      c = {
        state: 'closed',
        cooldownUntilMs: 0,
        consecutive429: 0,
        halfOpenInFlight: false,
        lastError: null,
      };
      this.circuits.set(model, c);
    }
    return c;
  }

  public canAttemptModel(model: string, nowMs = Date.now()): { allowed: boolean; waitMs: number } {
    const c = this.getOrCreateCircuit(model);
    if (c.state === 'closed') return { allowed: true, waitMs: 0 };
    if (c.state === 'open') {
      if (nowMs < c.cooldownUntilMs) {
        return { allowed: false, waitMs: c.cooldownUntilMs - nowMs };
      }
      c.state = 'half_open';
      c.halfOpenInFlight = false;
    }
    if (c.state === 'half_open') {
      if (c.halfOpenInFlight) {
        return { allowed: false, waitMs: 5000 };
      }
      return { allowed: true, waitMs: 0 };
    }
    return { allowed: true, waitMs: 0 };
  }

  private markSuccess(model: string, task: GeminiTaskType, res: unknown): void {
    const c = this.getOrCreateCircuit(model);
    c.state = 'closed';
    c.cooldownUntilMs = 0;
    c.consecutive429 = 0;
    c.halfOpenInFlight = false;
    c.lastError = null;

    const u = this.getOrCreateUsage(model);
    u.successes += 1;
    u.circuitState = 'closed';
    u.cooldownUntil = null;

    const taskStat = this.usageByTask.get(task) || {
      requests: 0,
      successes: 0,
      errors: 0,
      totalTokens: 0,
    };
    taskStat.successes += 1;

    const meta =
      res && typeof res === 'object' && 'usageMetadata' in res
        ? (res as {
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          }).usageMetadata
        : undefined;

    if (meta) {
      const promptTokens = Number(meta.promptTokenCount || 0);
      const candidatesTokens = Number(meta.candidatesTokenCount || 0);
      const totalTokens = Number(meta.totalTokenCount || promptTokens + candidatesTokens);
      u.promptTokens += promptTokens;
      u.candidatesTokens += candidatesTokens;
      u.totalTokens += totalTokens;
      taskStat.totalTokens += totalTokens;
    }
    this.usageByTask.set(task, taskStat);
  }

  private markFailure(model: string, task: GeminiTaskType, classified: ClassifiedGeminiError, nowMs = Date.now()): void {
    const c = this.getOrCreateCircuit(model);
    const u = this.getOrCreateUsage(model);
    u.errors += 1;
    u.lastError = classified.message.slice(0, 220);

    const taskStat = this.usageByTask.get(task) || {
      requests: 0,
      successes: 0,
      errors: 0,
      totalTokens: 0,
    };
    taskStat.errors += 1;
    this.usageByTask.set(task, taskStat);

    c.halfOpenInFlight = false;
    c.lastError = u.lastError;

    if (classified.kind === 'daily_quota_exhausted') {
      u.dailyExhausted429 += 1;
      const cooldown = Math.max(classified.retryAfterMs ?? 15 * 60_000, 5 * 60_000);
      c.state = 'open';
      c.cooldownUntilMs = nowMs + cooldown;
      c.consecutive429 += 1;
    } else if (classified.kind === 'rate_limit_rpm') {
      u.rateLimits429 += 1;
      c.consecutive429 += 1;
      // Immediately stop calling the model on 429 and honor Retry-After (default 60s when omitted)
      const cooldown = Math.max(classified.retryAfterMs ?? 60_000, 5_000);
      c.state = 'open';
      c.cooldownUntilMs = nowMs + cooldown;
    }

    u.circuitState = c.state;
    u.cooldownUntil = c.cooldownUntilMs > 0 ? new Date(c.cooldownUntilMs).toISOString() : null;
  }

  private async acquireSlot(): Promise<void> {
    const cfg = this.getRuntimeConfig();
    const maxConc = cfg.maxConcurrency;
    if (this.activeCount < maxConc) {
      this.activeCount += 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    // Application-level RPM safety limit (not a claim about Google's official quota)
    const rpm = cfg.rpmLimit;
    const now = Date.now();
    while (this.requestTimestamps.length > 0 && now - this.requestTimestamps[0] >= 60_000) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= rpm) {
      const oldest = this.requestTimestamps[0];
      const waitMs = Math.max(100, 60_000 - (now - oldest) + 50);
      if (waitMs > 10_000) {
        this.releaseSlot();
        throw new QuotaUnavailableError(
          cfg.primaryModel,
          waitMs,
          'rate_limit_rpm',
          `Application RPM safety limit (${rpm}/min) active; retry in ${Math.ceil(waitMs / 1000)}s.`
        );
      }
      await sleep(waitMs);
    }
    this.requestTimestamps.push(Date.now());
  }

  private releaseSlot(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  private async runWithModel<T>(
    model: string,
    task: GeminiTaskType,
    fn: (resolvedModel: string) => Promise<T>
  ): Promise<T> {
    const check = this.canAttemptModel(model);
    if (!check.allowed) {
      throw new QuotaUnavailableError(
        model,
        check.waitMs,
        'daily_quota_exhausted',
        `Model "${model}" temporarily disabled by circuit breaker (${Math.ceil(check.waitMs / 1000)}s cooldown).`
      );
    }

    const circuit = this.getOrCreateCircuit(model);
    const wasHalfOpen = circuit.state === 'half_open';
    if (wasHalfOpen) {
      circuit.halfOpenInFlight = true;
    }

    const maxTransientAttempts = 2;
    let attempt = 0;

    while (attempt < maxTransientAttempts) {
      attempt += 1;
      await this.acquireSlot();
      const u = this.getOrCreateUsage(model);
      u.requests += 1;
      const tStat = this.usageByTask.get(task) || {
        requests: 0,
        successes: 0,
        errors: 0,
        totalTokens: 0,
      };
      tStat.requests += 1;
      this.usageByTask.set(task, tStat);

      try {
        const result = await fn(model);
        this.markSuccess(model, task, result);
        this.releaseSlot();
        return result;
      } catch (err) {
        this.releaseSlot();
        const classified = classifyGeminiError(err);

        if (classified.kind === 'thinking_unsupported') {
          this.thinkingUnsupportedModels.add(model);
          if (attempt < maxTransientAttempts) {
            continue;
          }
        }

        if (classified.kind === 'daily_quota_exhausted') {
          this.markFailure(model, task, classified);
          const cooldown = Math.max(classified.retryAfterMs ?? 15 * 60_000, 5 * 60_000);
          throw new QuotaUnavailableError(model, cooldown, 'daily_quota_exhausted', classified.message);
        }

        if (classified.kind === 'rate_limit_rpm') {
          this.markFailure(model, task, classified);
          // Do NOT retry the same model after 429; honor Retry-After via open circuit breaker
          const cooldown = Math.max(classified.retryAfterMs ?? 60_000, 5_000);
          throw new QuotaUnavailableError(model, cooldown, 'rate_limit_rpm', classified.message);
        }

        if (classified.kind === 'transient_5xx' && attempt < maxTransientAttempts) {
          this.markFailure(model, task, classified);
          const backoffMs = 800 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
          await sleep(backoffMs);
          continue;
        }

        this.markFailure(model, task, classified);
        throw err;
      }
    }

    throw new QuotaUnavailableError(model, 60_000, 'rate_limit_rpm', `Model "${model}" retry budget exhausted.`);
  }

  public async execute<T>(params: {
    task: GeminiTaskType;
    preferredModel?: string;
    dedupKey?: string;
    allowFallback?: boolean;
    fn: (resolvedModel: string) => Promise<T>;
  }): Promise<T> {
    if (params.dedupKey) {
      const existing = this.dedupInFlight.get(params.dedupKey) as Promise<T> | undefined;
      if (existing) {
        this.dedupHits += 1;
        return existing;
      }
    }

    const runner = async (): Promise<T> => {
      const cfg = this.getRuntimeConfig();
      const primary = params.preferredModel || cfg.primaryModel;
      const candidateFallback = params.allowFallback !== false ? cfg.fallbackModel : null;
      const fallback = this.isFallbackAllowed(candidateFallback) ? candidateFallback : null;

      try {
        return await this.runWithModel(primary, params.task, params.fn);
      } catch (err) {
        const isQuotaOrTransient =
          err instanceof QuotaUnavailableError ||
          classifyGeminiError(err).kind === 'transient_5xx';

        if (
          isQuotaOrTransient &&
          fallback &&
          fallback !== primary &&
          isModelCompatibleWithTask(fallback, params.task)
        ) {
          return this.runWithModel(fallback, params.task, params.fn);
        }
        throw err;
      }
    };

    const promise = runner().finally(() => {
      if (params.dedupKey) {
        this.dedupInFlight.delete(params.dedupKey);
      }
    });

    if (params.dedupKey) {
      this.dedupInFlight.set(params.dedupKey, promise);
    }
    return promise;
  }

  public getStatsSnapshot(): {
    primaryModel: string;
    fallbackModel: string | null;
    fallbackVerified: boolean;
    maxConcurrency: number;
    rpmLimit: number;
    rpmLimitNote: string;
    validationWarnings: string[];
    activeRequests: number;
    dedupHits: number;
    models: Record<string, ModelUsageCounter>;
    tasks: Record<string, { requests: number; successes: number; errors: number; totalTokens: number }>;
  } {
    const cfg = this.getRuntimeConfig();
    const models: Record<string, ModelUsageCounter> = {};
    for (const [k, v] of this.usageByModel.entries()) {
      const check = this.canAttemptModel(k);
      models[k] = {
        ...v,
        circuitState: check.allowed ? this.getOrCreateCircuit(k).state : 'open',
      };
    }

    const tasks: Record<string, { requests: number; successes: number; errors: number; totalTokens: number }> = {};
    for (const [k, v] of this.usageByTask.entries()) {
      tasks[k] = { ...v };
    }

    return {
      primaryModel: cfg.primaryModel,
      fallbackModel: cfg.fallbackModel,
      fallbackVerified: this.isFallbackAllowed(cfg.fallbackModel),
      maxConcurrency: cfg.maxConcurrency,
      rpmLimit: cfg.rpmLimit,
      rpmLimitNote: APP_RPM_SAFETY_NOTE,
      validationWarnings: cfg.warnings,
      activeRequests: this.activeCount,
      dedupHits: this.dedupHits,
      models,
      tasks,
    };
  }

  public resetForTests(): void {
    this.activeCount = 0;
    this.waitQueue = [];
    this.requestTimestamps = [];
    this.circuits.clear();
    this.usageByModel.clear();
    this.usageByTask.clear();
    this.dedupInFlight.clear();
    this.thinkingUnsupportedModels.clear();
    this.verifiedFallbackModels.clear();
    this.validatedConfig = null;
    this.dedupHits = 0;
  }
}

export const geminiQuotaManager = new GeminiQuotaManager();
