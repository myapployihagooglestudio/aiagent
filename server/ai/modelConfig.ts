import { ThinkingLevel } from '@google/genai';

export const DEFAULT_PRIMARY_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_FALLBACK_MODEL: string | null = null;
export const DEFAULT_MAX_CONCURRENCY = 2;
export const DEFAULT_RPM_LIMIT = 10;
export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const APP_RPM_SAFETY_NOTE =
  "Application-level safety limit; not a claim about Google's official quota.";

const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

// Old primary model known to exhaust free-tier quota — never auto-selected as fallback
// and rejected unless explicitly verified available & with quota.
const LEGACY_QUOTA_RISK_MODELS = new Set(['gemini-4-hydrogen']);

export interface GeminiModelSettings {
  primaryModel: string;
  fallbackModel: string | null;
  transcriptionModel: string;
  ttsModel: string;
}

export interface ValidatedGeminiConfig extends GeminiModelSettings {
  maxConcurrency: number;
  rpmLimit: number;
  rpmLimitNote: string;
  requiresFallbackVerification: boolean;
  warnings: string[];
  valid: boolean;
}

export function isDeprecatedOrInvalidModel(modelId: string): boolean {
  const clean = modelId.trim().toLowerCase();
  if (!clean) return true;
  if (DEPRECATED_MODELS.has(clean)) return true;
  if (!/^[a-z0-9.-]+$/.test(clean)) return true;
  return false;
}

export function isLegacyQuotaRiskModel(modelId: string): boolean {
  return LEGACY_QUOTA_RISK_MODELS.has(modelId.trim().toLowerCase());
}

export function validateAndLoadGeminiConfig(): ValidatedGeminiConfig {
  const warnings: string[] = [];

  const rawPrimary = process.env.GEMINI_PRIMARY_MODEL?.trim();
  let primaryModel = DEFAULT_PRIMARY_MODEL;
  if (rawPrimary) {
    if (isDeprecatedOrInvalidModel(rawPrimary)) {
      warnings.push(
        `GEMINI_PRIMARY_MODEL="${rawPrimary}" is deprecated or invalid; using "${DEFAULT_PRIMARY_MODEL}".`
      );
    } else {
      primaryModel = rawPrimary;
    }
  }

  const rawFallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
  let fallbackModel: string | null = DEFAULT_FALLBACK_MODEL;
  let requiresFallbackVerification = false;
  if (rawFallback) {
    if (isDeprecatedOrInvalidModel(rawFallback)) {
      warnings.push(
        `GEMINI_FALLBACK_MODEL="${rawFallback}" is deprecated or invalid; fallback disabled.`
      );
    } else if (rawFallback === primaryModel) {
      warnings.push(
        `GEMINI_FALLBACK_MODEL="${rawFallback}" matches primary model; redundant fallback disabled.`
      );
    } else {
      fallbackModel = rawFallback;
      if (isLegacyQuotaRiskModel(rawFallback)) {
        requiresFallbackVerification = true;
        warnings.push(
          `GEMINI_FALLBACK_MODEL="${rawFallback}" is an older quota-sensitive model; it will remain disabled unless live availability/quota verification succeeds.`
        );
      }
    }
  }

  let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  const rawConc = process.env.GEMINI_MAX_CONCURRENCY?.trim();
  if (rawConc !== undefined && rawConc !== '') {
    const parsed = Number(rawConc);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      warnings.push(
        `GEMINI_MAX_CONCURRENCY="${rawConc}" must be an integer between 1 and 20; using default ${DEFAULT_MAX_CONCURRENCY}.`
      );
    } else {
      maxConcurrency = parsed;
    }
  }

  let rpmLimit = DEFAULT_RPM_LIMIT;
  const rawRpm = process.env.GEMINI_RPM_LIMIT?.trim();
  if (rawRpm !== undefined && rawRpm !== '') {
    const parsed = Number(rawRpm);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      warnings.push(
        `GEMINI_RPM_LIMIT="${rawRpm}" must be an integer between 1 and 500; using default ${DEFAULT_RPM_LIMIT}.`
      );
    } else {
      rpmLimit = parsed;
    }
  }

  return {
    primaryModel,
    fallbackModel,
    transcriptionModel:
      process.env.GEMINI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
    ttsModel: process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
    maxConcurrency,
    rpmLimit,
    rpmLimitNote: APP_RPM_SAFETY_NOTE,
    requiresFallbackVerification,
    warnings,
    valid: warnings.length === 0,
  };
}

export function getPrimaryGeminiModel(): string {
  return validateAndLoadGeminiConfig().primaryModel;
}

export function getFallbackGeminiModel(): string | null {
  return validateAndLoadGeminiConfig().fallbackModel;
}

export function getMaxConcurrencyConfig(): number {
  return validateAndLoadGeminiConfig().maxConcurrency;
}

export function getRpmLimitConfig(): number {
  return validateAndLoadGeminiConfig().rpmLimit;
}

export function getGeminiModelSettings(): GeminiModelSettings {
  const cfg = validateAndLoadGeminiConfig();
  return {
    primaryModel: cfg.primaryModel,
    fallbackModel: cfg.fallbackModel,
    transcriptionModel: cfg.transcriptionModel,
    ttsModel: cfg.ttsModel,
  };
}

export function isModelCompatibleWithTask(
  modelId: string,
  task: 'reply' | 'intent' | 'search' | 'qc' | 'stt' | 'tts'
): boolean {
  const clean = modelId.trim().toLowerCase();
  if (isDeprecatedOrInvalidModel(clean)) return false;

  if (task === 'tts') {
    return clean.includes('tts');
  }
  if (task === 'stt') {
    return clean.includes('transcribe') || clean.includes('flash') || clean.includes('hydrogen');
  }
  // Text/multimodal reasoning tasks must not route to TTS-only/embedding-only models
  if (
    clean.includes('tts') ||
    clean.includes('embedding') ||
    clean.includes('lyria') ||
    clean.includes('image')
  ) {
    return false;
  }
  return true;
}

export function getThinkingConfigForModel(
  modelId: string,
  disabledModels?: ReadonlySet<string>
): { thinkingLevel: ThinkingLevel } | undefined {
  if (process.env.GEMINI_DISABLE_THINKING === 'true') {
    return undefined;
  }
  if (disabledModels?.has(modelId)) {
    return undefined;
  }
  const lower = modelId.toLowerCase();
  if (lower.startsWith('gemini-3') || lower.startsWith('gemini-4')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}
