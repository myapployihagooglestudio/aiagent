import { applicationDefault, cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { containsSensitiveSecret, sanitizeForLog } from './ai/securityFilter.ts';
import type {
  AuditLogEntry,
  BotSettings,
  ChatChannel,
  ChatPermission,
  ChatRule,
  ConversationMessage,
  MemoryEntry,
  MemoryScope,
  MemoryType,
  PendingApproval,
  QueueJob,
  UILanguage,
  UserLanguagePreference,
  UserProfile,
} from './types.ts';

function isTransientFirestoreError(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  if (code === 14 || code === 10 || code === 4 || code === 8) return true;
  if (
    code === 'UNAVAILABLE' ||
    code === 'ABORTED' ||
    code === 'DEADLINE_EXCEEDED' ||
    code === 'RESOURCE_EXHAUSTED'
  ) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('UNAVAILABLE') ||
    msg.includes('ABORTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

export async function withFirestoreRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientFirestoreError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const delayMs = 200 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

const DEFAULT_PERSONA =
  "Siz OMNIA AI — egangizning shaxsiy Telegram yordamchisisiz. Murojaat tiliga mos ravishda (o'zbekcha lotin, o'zbekcha kirill, ruscha yoki inglizcha) aniq, madaniyatli, tabiiy va professional javob bering. Bilmagan ma'lumotingizni aslo to'qib chiqarmang.";

let firebaseApp: App | null = null;
let firestoreDb: Firestore | null = null;
let credentialSource: 'service_account_json' | 'adc' = 'adc';
let configuredServiceAccountEmail: string | null = null;
let lastProbeStatus: {
  connected: boolean;
  checkedAt: string | null;
  error: string | null;
  serviceAccount: string | null;
  remediation: string | null;
} = {
  connected: false,
  checkedAt: null,
  error: 'Not probed yet',
  serviceAccount: null,
  remediation: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultBotSettings(): BotSettings {
  return {
    uiLanguage: 'uz_lat',
    defaultReplyLanguage: 'auto',
    responseStyle: 'executive',
    verbosityMode: 'balanced',
    emojiLevel: 'subtle',
    customStyleExamples: '',
    autoReplyMode: 'autonomous',
    autonomousEnabled: true,
    paused: false,
    botPaused: false,
    businessPaused: false,
    emergencyStop: false,
    voiceReplyEnabled: false,
    voiceOutputMode: 'text',
    ttsVoice: 'Kore',
    voiceStyle: 'calm',
    speakingSpeed: 'normal',
    autoTranscribeVoice: true,
    autoAnalyzeVideo: true,
    videoReplyEnabled: false,
    callsEnabled: false,
    aiConsentConfirmed: true,
    disclosureEnabled: true,
    disclosureText: 'AI yordamchi',
    confidenceThreshold: 70,
    rateLimitPerMinute: 12,
    personaPrompt: DEFAULT_PERSONA,
    memorySummary: '',
    escalationKeywords: "pul, karta, parol, kod, shartnoma, to'lov, pin, cvv",
    ownerTelegramId: 0,
    ownerUsername: '',
    businessConnectionId: '',
    connectionEnabled: false,
    businessOwnerId: 0,
    businessOwnerName: '',
    rightsCanReply: false,
    rightsCanReadMessages: false,
    rightsCanDeleteSent: false,
    lastWebhookAt: '',
    lastWebhookEvent: '',
    updatedAt: nowIso(),
  };
}

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const jsonText = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as ServiceAccount & { client_email?: string; private_key?: string };
    if (parsed && (parsed.privateKey || parsed.private_key) && (parsed.clientEmail || parsed.client_email)) {
      return parsed;
    }
  } catch {
    console.warn('[Omnia AI] FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed; falling back to ADC.');
  }
  return null;
}

function getFirestoreClient(): Firestore {
  if (firestoreDb) return firestoreDb;
  const sa = parseServiceAccountFromEnv();
  if (sa) {
    credentialSource = 'service_account_json';
    configuredServiceAccountEmail =
      (sa as { clientEmail?: string; client_email?: string }).clientEmail ||
      (sa as { client_email?: string }).client_email ||
      null;
  } else {
    credentialSource = 'adc';
    configuredServiceAccountEmail = null;
  }

  firebaseApp =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: sa ? cert(sa) : applicationDefault(),
          projectId: firebaseConfig.projectId,
        });
  firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  return firestoreDb;
}

async function detectRuntimeServiceAccount(): Promise<string | null> {
  if (configuredServiceAccountEmail) {
    return configuredServiceAccountEmail;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.text()).trim() || null;
  } catch {
    return null;
  }
}

function buildFirestoreRemediation(errorMsg: string, serviceAccount: string | null): string | null {
  if (!errorMsg.includes('PERMISSION_DENIED')) return null;
  const sa = serviceAccount || '<runtime-service-account>';
  return (
    `Grant roles/datastore.user to ${sa} on GCP project "${firebaseConfig.projectId}" ` +
    `(gcloud projects add-iam-policy-binding ${firebaseConfig.projectId} --member="serviceAccount:${sa}" --role="roles/datastore.user"), ` +
    `or set FIREBASE_SERVICE_ACCOUNT_JSON for project "${firebaseConfig.projectId}", or deploy directly to Cloud Run in "${firebaseConfig.projectId}".`
  );
}

export function getDbInfo(): {
  ready: boolean;
  driver: 'firestore';
  projectId: string;
  databaseId: string;
  credentialSource: 'service_account_json' | 'adc';
  error: string | null;
  checkedAt: string | null;
  serviceAccount: string | null;
  remediation: string | null;
} {
  return {
    ready: lastProbeStatus.connected,
    driver: 'firestore',
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
    credentialSource,
    error: lastProbeStatus.error,
    checkedAt: lastProbeStatus.checkedAt,
    serviceAccount: lastProbeStatus.serviceAccount,
    remediation: lastProbeStatus.remediation,
  };
}

export async function probeFirestoreConnection(): Promise<{
  connected: boolean;
  error: string | null;
  serviceAccount: string | null;
  remediation: string | null;
}> {
  try {
    const db = getFirestoreClient();
    const serviceAccount = await detectRuntimeServiceAccount();
    const probeRef = db.collection('system').doc('_health_probe');
    const probeVal = `probe_${Date.now()}`;
    await probeRef.set({ probeVal, updatedAt: nowIso() });
    const snap = await probeRef.get();
    const readBack = snap.data()?.probeVal;
    await probeRef.delete();

    if (readBack !== probeVal) {
      throw new Error('Firestore read-back verification mismatch.');
    }

    lastProbeStatus = {
      connected: true,
      checkedAt: nowIso(),
      error: null,
      serviceAccount,
      remediation: null,
    };
    return { connected: true, error: null, serviceAccount, remediation: null };
  } catch (err) {
    const serviceAccount = await detectRuntimeServiceAccount();
    const msg = err instanceof Error ? err.message : String(err);
    const remediation = buildFirestoreRemediation(msg, serviceAccount);
    lastProbeStatus = {
      connected: false,
      checkedAt: nowIso(),
      error: msg,
      serviceAccount,
      remediation,
    };
    return { connected: false, error: msg, serviceAccount, remediation };
  }
}

export async function initDatabase(): Promise<void> {
  getFirestoreClient();
  const probe = await probeFirestoreConnection();
  if (probe.connected) {
    await ensureDefaultSettings();
  }
}

export async function closeDatabase(): Promise<void> {
  if (firestoreDb) {
    await firestoreDb.terminate().catch(() => {});
    firestoreDb = null;
  }
}

function asIsoString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return nowIso();
}

function mapBotSettings(data: Record<string, unknown> | undefined): BotSettings {
  const def = defaultBotSettings();
  if (!data) return def;
  const voiceReplyEnabled =
    typeof data.voiceReplyEnabled === 'boolean' ? data.voiceReplyEnabled : def.voiceReplyEnabled;
  const voiceOutputMode =
    (data.voiceOutputMode as BotSettings['voiceOutputMode']) ||
    (voiceReplyEnabled ? 'voice' : 'text');

  return {
    uiLanguage: (data.uiLanguage as BotSettings['uiLanguage']) || def.uiLanguage,
    defaultReplyLanguage:
      (data.defaultReplyLanguage as BotSettings['defaultReplyLanguage']) || def.defaultReplyLanguage,
    responseStyle: (data.responseStyle as BotSettings['responseStyle']) || def.responseStyle,
    verbosityMode: (data.verbosityMode as BotSettings['verbosityMode']) || def.verbosityMode,
    emojiLevel: (data.emojiLevel as BotSettings['emojiLevel']) || def.emojiLevel,
    customStyleExamples:
      typeof data.customStyleExamples === 'string'
        ? data.customStyleExamples
        : def.customStyleExamples,
    autoReplyMode: (data.autoReplyMode as BotSettings['autoReplyMode']) || def.autoReplyMode,
    autonomousEnabled:
      typeof data.autonomousEnabled === 'boolean' ? data.autonomousEnabled : def.autonomousEnabled,
    paused: typeof data.paused === 'boolean' ? data.paused : def.paused,
    botPaused: typeof data.botPaused === 'boolean' ? data.botPaused : def.botPaused,
    businessPaused:
      typeof data.businessPaused === 'boolean' ? data.businessPaused : def.businessPaused,
    emergencyStop: typeof data.emergencyStop === 'boolean' ? data.emergencyStop : def.emergencyStop,
    voiceReplyEnabled,
    voiceOutputMode,
    ttsVoice: (data.ttsVoice as BotSettings['ttsVoice']) || def.ttsVoice,
    voiceStyle: (data.voiceStyle as BotSettings['voiceStyle']) || def.voiceStyle,
    speakingSpeed: (data.speakingSpeed as BotSettings['speakingSpeed']) || def.speakingSpeed,
    autoTranscribeVoice:
      typeof data.autoTranscribeVoice === 'boolean' ? data.autoTranscribeVoice : def.autoTranscribeVoice,
    autoAnalyzeVideo:
      typeof data.autoAnalyzeVideo === 'boolean' ? data.autoAnalyzeVideo : def.autoAnalyzeVideo,
    videoReplyEnabled:
      typeof data.videoReplyEnabled === 'boolean' ? data.videoReplyEnabled : def.videoReplyEnabled,
    callsEnabled: typeof data.callsEnabled === 'boolean' ? data.callsEnabled : def.callsEnabled,
    aiConsentConfirmed:
      typeof data.aiConsentConfirmed === 'boolean' ? data.aiConsentConfirmed : def.aiConsentConfirmed,
    disclosureEnabled:
      typeof data.disclosureEnabled === 'boolean' ? data.disclosureEnabled : def.disclosureEnabled,
    disclosureText: typeof data.disclosureText === 'string' ? data.disclosureText : def.disclosureText,
    confidenceThreshold:
      typeof data.confidenceThreshold === 'number' ? data.confidenceThreshold : def.confidenceThreshold,
    rateLimitPerMinute:
      typeof data.rateLimitPerMinute === 'number' ? data.rateLimitPerMinute : def.rateLimitPerMinute,
    personaPrompt:
      typeof data.personaPrompt === 'string' && data.personaPrompt
        ? data.personaPrompt
        : def.personaPrompt,
    memorySummary: typeof data.memorySummary === 'string' ? data.memorySummary : def.memorySummary,
    escalationKeywords:
      typeof data.escalationKeywords === 'string' ? data.escalationKeywords : def.escalationKeywords,
    ownerTelegramId:
      typeof data.ownerTelegramId === 'number' ? data.ownerTelegramId : def.ownerTelegramId,
    ownerUsername: typeof data.ownerUsername === 'string' ? data.ownerUsername : def.ownerUsername,
    businessConnectionId:
      typeof data.businessConnectionId === 'string'
        ? data.businessConnectionId
        : def.businessConnectionId,
    connectionEnabled:
      typeof data.connectionEnabled === 'boolean' ? data.connectionEnabled : def.connectionEnabled,
    businessOwnerId:
      typeof data.businessOwnerId === 'number' ? data.businessOwnerId : def.businessOwnerId,
    businessOwnerName:
      typeof data.businessOwnerName === 'string' ? data.businessOwnerName : def.businessOwnerName,
    rightsCanReply:
      typeof data.rightsCanReply === 'boolean' ? data.rightsCanReply : def.rightsCanReply,
    rightsCanReadMessages:
      typeof data.rightsCanReadMessages === 'boolean'
        ? data.rightsCanReadMessages
        : def.rightsCanReadMessages,
    rightsCanDeleteSent:
      typeof data.rightsCanDeleteSent === 'boolean'
        ? data.rightsCanDeleteSent
        : def.rightsCanDeleteSent,
    lastWebhookAt: typeof data.lastWebhookAt === 'string' ? data.lastWebhookAt : def.lastWebhookAt,
    lastWebhookEvent:
      typeof data.lastWebhookEvent === 'string' ? data.lastWebhookEvent : def.lastWebhookEvent,
    updatedAt: asIsoString(data.updatedAt),
  };
}

async function ensureDefaultSettings(): Promise<void> {
  const db = getFirestoreClient();
  const ref = db.collection('system').doc('bot_settings');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set(defaultBotSettings());
  }
}

export async function getBotSettings(): Promise<BotSettings> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const ref = db.collection('system').doc('bot_settings');
    const snap = await ref.get();
    if (!snap.exists) {
      const def = defaultBotSettings();
      await ref.set(def);
      return def;
    }
    return mapBotSettings(snap.data());
  });
}

export async function updateBotSettings(
  patch: Partial<Omit<BotSettings, 'updatedAt'>>
): Promise<BotSettings> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const ref = db.collection('system').doc('bot_settings');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? mapBotSettings(snap.data()) : defaultBotSettings();
      const next: BotSettings = {
        ...current,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
        updatedAt: nowIso(),
      } as BotSettings;
      tx.set(ref, next, { merge: true });
      return next;
    });
  });
}

export async function getUserLanguagePreference(
  userId: string
): Promise<UserLanguagePreference | null> {
  if (!userId || !/^[0-9]+$/.test(userId)) return null;
  const db = getFirestoreClient();
  const snap = await db.collection('user_preferences').doc(userId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    userId: String(d.userId || userId),
    preferredLanguage: (d.preferredLanguage as UserLanguagePreference['preferredLanguage']) || 'auto',
    uiLanguage: (d.uiLanguage as UILanguage) || 'uz_lat',
    username: String(d.username || ''),
    displayName: String(d.displayName || ''),
    updatedAt: asIsoString(d.updatedAt),
  };
}

export async function setUserLanguagePreference(params: {
  userId: string;
  preferredLanguage: UserLanguagePreference['preferredLanguage'];
  uiLanguage?: UILanguage;
  username?: string;
  displayName?: string;
}): Promise<UserLanguagePreference> {
  const cleanId = params.userId.trim();
  if (!/^[0-9]+$/.test(cleanId)) {
    throw new Error('Noto‘g‘ri Telegram userId.');
  }
  const db = getFirestoreClient();
  const existing = await getUserLanguagePreference(cleanId).catch(() => null);
  const nextUiLang: UILanguage =
    params.uiLanguage ||
    (params.preferredLanguage !== 'auto'
      ? params.preferredLanguage
      : existing?.uiLanguage || 'uz_lat');

  const record: UserLanguagePreference = {
    userId: cleanId,
    preferredLanguage: params.preferredLanguage,
    uiLanguage: nextUiLang,
    username: (params.username ?? existing?.username ?? '').slice(0, 64),
    displayName: (params.displayName ?? existing?.displayName ?? '').slice(0, 120),
    updatedAt: nowIso(),
  };

  await withFirestoreRetry(() =>
    db.collection('user_preferences').doc(cleanId).set(record, { merge: true })
  );
  return record;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const cleanId = userId.trim();
  if (!/^[0-9]+$/.test(cleanId)) return null;
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const snap = await db.collection('user_profiles').doc(cleanId).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return {
      userId: String(d.userId || cleanId),
      channel: (d.channel as ChatChannel) || 'business_chat',
      username: String(d.username || ''),
      displayName: String(d.displayName || ''),
      languageCode: String(d.languageCode || ''),
      messageCount: Number(d.messageCount || 0),
      lastSeenAt: asIsoString(d.lastSeenAt),
      createdAt: asIsoString(d.createdAt),
      updatedAt: asIsoString(d.updatedAt),
    };
  });
}

export async function upsertUserProfile(params: {
  userId: string;
  channel: ChatChannel;
  username?: string;
  displayName?: string;
  languageCode?: string;
}): Promise<void> {
  const cleanId = params.userId.trim();
  if (!/^[0-9]+$/.test(cleanId)) return;
  await withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const ref = db.collection('user_profiles').doc(cleanId);
    const ts = nowIso();
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        userId: cleanId,
        channel: params.channel,
        username: (params.username || '').slice(0, 64),
        displayName: (params.displayName || '').slice(0, 120),
        languageCode: (params.languageCode || '').slice(0, 16),
        messageCount: 1,
        lastSeenAt: ts,
        createdAt: ts,
        updatedAt: ts,
      });
      return;
    }
    const patch: Record<string, unknown> = {
      channel: params.channel,
      messageCount: FieldValue.increment(1),
      lastSeenAt: ts,
      updatedAt: ts,
    };
    if (params.username !== undefined) patch.username = params.username.slice(0, 64);
    if (params.displayName !== undefined) patch.displayName = params.displayName.slice(0, 120);
    if (params.languageCode !== undefined && params.languageCode) {
      patch.languageCode = params.languageCode.slice(0, 16);
    }
    await ref.set(patch, { merge: true });
  });
}

export async function claimDedupKey(dedupKey: string): Promise<boolean> {
  const db = getFirestoreClient();
  try {
    await db.collection('dedup').doc(dedupKey).create({
      dedupKey,
      createdAt: nowIso(),
    });
    return true;
  } catch (err) {
    const code = (err as { code?: number | string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 6 || msg.includes('ALREADY_EXISTS')) {
      return false;
    }
    throw err;
  }
}

function ruleDocId(channel: ChatChannel, chatId: string): string {
  return `${channel}__${chatId}`;
}

export async function getChatRule(channel: ChatChannel, chatId: string): Promise<ChatRule | null> {
  const db = getFirestoreClient();
  const snap = await db.collection('chat_rules').doc(ruleDocId(channel, chatId)).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    chatId: String(data.chatId || chatId),
    channel: (data.channel as ChatChannel) || channel,
    contactName: String(data.contactName || ''),
    username: String(data.username || ''),
    permission: (data.permission as ChatPermission) || 'allow',
    aiConsentGranted: typeof data.aiConsentGranted === 'boolean' ? data.aiConsentGranted : true,
    styleOverride: String(data.styleOverride || ''),
    notes: String(data.notes || ''),
    lastInboundAt: data.lastInboundAt ? String(data.lastInboundAt) : null,
    updatedAt: asIsoString(data.updatedAt),
  };
}

export async function listChatRules(limit = 25): Promise<ChatRule[]> {
  const db = getFirestoreClient();
  const snap = await db.collection('chat_rules').limit(limit).get();
  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      chatId: String(d.chatId || ''),
      channel: (d.channel as ChatChannel) || 'business_chat',
      contactName: String(d.contactName || ''),
      username: String(d.username || ''),
      permission: (d.permission as ChatPermission) || 'allow',
      aiConsentGranted: typeof d.aiConsentGranted === 'boolean' ? d.aiConsentGranted : true,
      styleOverride: String(d.styleOverride || ''),
      notes: String(d.notes || ''),
      lastInboundAt: d.lastInboundAt ? String(d.lastInboundAt) : null,
      updatedAt: asIsoString(d.updatedAt),
    };
  });
}

export async function upsertChatRule(params: {
  channel: ChatChannel;
  chatId: string;
  contactName?: string;
  username?: string;
  permission?: ChatPermission;
  aiConsentGranted?: boolean;
  styleOverride?: string;
  notes?: string;
  lastInboundAt?: string;
}): Promise<void> {
  const db = getFirestoreClient();
  const existing = await getChatRule(params.channel, params.chatId);
  const payload: Record<string, unknown> = {
    channel: params.channel,
    chatId: params.chatId,
    contactName: (params.contactName ?? existing?.contactName ?? '').slice(0, 120),
    username: (params.username ?? existing?.username ?? '').slice(0, 64),
    permission: params.permission ?? existing?.permission ?? 'allow',
    aiConsentGranted: params.aiConsentGranted ?? existing?.aiConsentGranted ?? true,
    styleOverride: (params.styleOverride ?? existing?.styleOverride ?? '').slice(0, 1000),
    notes: (params.notes ?? existing?.notes ?? '').slice(0, 2000),
    updatedAt: nowIso(),
  };
  const nextInbound = params.lastInboundAt ?? existing?.lastInboundAt;
  if (nextInbound) {
    payload.lastInboundAt = nextInbound;
  }
  await db.collection('chat_rules').doc(ruleDocId(params.channel, params.chatId)).set(payload, { merge: true });
}

export async function createMemoryRecord(params: {
  type: MemoryType;
  scope: MemoryScope;
  channel: ChatChannel | 'global';
  chatId?: string;
  content: string;
  provenance?: string;
  tags?: string;
  ttlHours?: number;
}): Promise<MemoryEntry> {
  const secretCheck = containsSensitiveSecret(params.content);
  if (secretCheck.hasSecret) {
    throw new Error(`Maxfiy ma'lumot (${secretCheck.reasons.join(', ')}) xotiraga saqlanmaydi.`);
  }

  const db = getFirestoreClient();
  const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const ts = nowIso();
  const nowMs = Date.now();
  const expiresAtMs =
    params.ttlHours && params.ttlHours > 0 ? nowMs + params.ttlHours * 3600 * 1000 : 0;

  const entry: Omit<MemoryEntry, 'id'> = {
    type: params.type,
    scope: params.scope,
    channel: params.scope === 'owner' ? 'global' : params.channel,
    chatId: params.scope === 'owner' ? '' : (params.chatId || '').slice(0, 64),
    content: sanitizeForLog(params.content).slice(0, 1500),
    provenance: (params.provenance || 'owner_command').slice(0, 64),
    tags: (params.tags || '').slice(0, 300),
    expiresAtMs,
    createdAtMs: nowMs,
    createdAt: ts,
    updatedAt: ts,
  };

  await db.collection('memories').doc(id).set(entry);
  return { id, ...entry };
}

function mapMemoryDoc(id: string, d: Record<string, unknown> | undefined): MemoryEntry | null {
  if (!d || typeof d.content !== 'string' || !d.content.trim()) {
    return null;
  }
  const scope = d.scope === 'owner' || d.scope === 'chat' ? d.scope : null;
  if (!scope) return null;
  return {
    id,
    type: (d.type as MemoryType) || 'owner_fact',
    scope,
    channel: (d.channel as MemoryEntry['channel']) || 'global',
    chatId: String(d.chatId || ''),
    content: d.content.trim(),
    provenance: String(d.provenance || ''),
    tags: String(d.tags || ''),
    expiresAtMs: Number(d.expiresAtMs || 0),
    createdAtMs: Number(d.createdAtMs || 0),
    createdAt: asIsoString(d.createdAt),
    updatedAt: asIsoString(d.updatedAt),
  };
}

export async function listScopedMemories(params: {
  channel: ChatChannel;
  chatId: string;
  limit?: number;
}): Promise<MemoryEntry[]> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const limit = params.limit ?? 30;
    const nowMs = Date.now();

    // Only load owner-scoped memories in private owner channel (bot_direct).
    const queries = [
      db
        .collection('memories')
        .where('channel', '==', params.channel)
        .where('chatId', '==', params.chatId)
        .orderBy('createdAtMs', 'desc')
        .limit(limit)
        .get(),
    ];
    if (params.channel === 'bot_direct') {
      queries.unshift(
        db.collection('memories').where('scope', '==', 'owner').orderBy('createdAtMs', 'desc').limit(limit).get()
      );
    }

    const snaps = await Promise.all(queries);
    const combined: MemoryEntry[] = [];
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const mapped = mapMemoryDoc(doc.id, doc.data());
        if (mapped && (mapped.expiresAtMs === 0 || mapped.expiresAtMs > nowMs)) {
          combined.push(mapped);
        }
      }
    }
    return combined;
  });
}

export async function listAllMemories(limit = 40): Promise<MemoryEntry[]> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const snap = await db.collection('memories').orderBy('createdAtMs', 'desc').limit(limit).get();
    const nowMs = Date.now();
    return snap.docs
      .map((d) => mapMemoryDoc(d.id, d.data()))
      .filter((m): m is MemoryEntry => m !== null && (m.expiresAtMs === 0 || m.expiresAtMs > nowMs));
  });
}

export async function searchMemoryRecords(keyword: string, limit = 25): Promise<MemoryEntry[]> {
  const q = keyword.trim().toLowerCase();
  const all = await listAllMemories(120);
  if (!q) return all.slice(0, limit);
  return all
    .filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

export async function clearMemoryRecords(filter?: {
  scope?: MemoryScope;
  channel?: ChatChannel;
  chatId?: string;
}): Promise<number> {
  const db = getFirestoreClient();
  let snap;
  if (filter?.channel && filter?.chatId) {
    snap = await db
      .collection('memories')
      .where('channel', '==', filter.channel)
      .where('chatId', '==', filter.chatId)
      .limit(200)
      .get();
  } else if (filter?.scope) {
    snap = await db.collection('memories').where('scope', '==', filter.scope).limit(200).get();
  } else {
    snap = await db.collection('memories').limit(300).get();
  }

  if (snap.empty) return 0;
  const batch = db.batch();
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
  }
  await batch.commit();
  return snap.size;
}

export async function addConversationMessage(params: {
  channel: ChatChannel;
  chatId: string;
  telegramMessageId?: number;
  role: 'user' | 'assistant' | 'owner';
  mediaType: ConversationMessage['mediaType'];
  text: string;
  transcript?: string;
  status: ConversationMessage['status'];
}): Promise<void> {
  const db = getFirestoreClient();
  const convId = ruleDocId(params.channel, params.chatId);
  const ts = nowIso();
  const convRef = db.collection('conversations').doc(convId);

  await convRef.set(
    {
      channel: params.channel,
      chatId: params.chatId,
      updatedAt: ts,
    },
    { merge: true }
  );

  const msgId = params.telegramMessageId
    ? `tg_${params.telegramMessageId}`
    : `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  await convRef.collection('messages').doc(msgId).set({
    channel: params.channel,
    chatId: params.chatId,
    telegramMessageId: params.telegramMessageId || 0,
    role: params.role,
    mediaType: params.mediaType,
    text: params.text.slice(0, 8000),
    transcript: (params.transcript || '').slice(0, 8000),
    status: params.status,
    seq: Date.now(),
    createdAt: ts,
  });
}

export async function updateMessageStatusByTelegramId(
  channel: ChatChannel,
  chatId: string,
  telegramMessageId: number,
  updates: { text?: string; status: ConversationMessage['status'] }
): Promise<void> {
  const db = getFirestoreClient();
  const docRef = db
    .collection('conversations')
    .doc(ruleDocId(channel, chatId))
    .collection('messages')
    .doc(`tg_${telegramMessageId}`);
  const snap = await docRef.get();
  if (!snap.exists) return;

  const patch: Record<string, unknown> = { status: updates.status };
  if (updates.text !== undefined) {
    patch.text = updates.text.slice(0, 8000);
  }
  await docRef.set(patch, { merge: true });
}

export async function getConversationHistory(
  channel: ChatChannel,
  chatId: string,
  limit = 16
): Promise<Array<{ role: 'user' | 'assistant' | 'owner'; text: string }>> {
  const db = getFirestoreClient();
  const snap = await db
    .collection('conversations')
    .doc(ruleDocId(channel, chatId))
    .collection('messages')
    .orderBy('seq', 'desc')
    .limit(limit + 10)
    .get();

  return snap.docs
    .map((d) => d.data())
    .filter((m) => m.status !== 'deleted')
    .slice(0, limit)
    .reverse()
    .map((m) => ({
      role: (m.role as 'user' | 'assistant' | 'owner') || 'user',
      text: String(m.transcript || m.text || ''),
    }));
}

export async function clearConversationHistory(channel: ChatChannel, chatId: string): Promise<void> {
  const db = getFirestoreClient();
  const colRef = db.collection('conversations').doc(ruleDocId(channel, chatId)).collection('messages');
  const snap = await colRef.limit(200).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
  }
  await batch.commit();
}

export async function createPendingApproval(params: {
  chatId: string;
  contactName: string;
  businessConnectionId: string;
  replyToMessageId: number;
  incomingText: string;
  incomingMediaType: string;
  draftReply: string;
  escalationReason: string;
  confidenceScore: number;
}): Promise<string> {
  const db = getFirestoreClient();
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ts = nowIso();
  const nowMs = Date.now();

  await db.collection('pending_approvals').doc(id).set({
    chatId: params.chatId,
    contactName: params.contactName.slice(0, 120),
    businessConnectionId: params.businessConnectionId,
    replyToMessageId: params.replyToMessageId,
    incomingText: sanitizeForLog(params.incomingText).slice(0, 4000),
    incomingMediaType: params.incomingMediaType,
    draftReply: sanitizeForLog(params.draftReply).slice(0, 4000),
    escalationReason: params.escalationReason.slice(0, 300),
    confidenceScore: params.confidenceScore,
    status: 'pending',
    notificationMessageId: 0,
    createdAtMs: nowMs,
    createdAt: ts,
    updatedAt: ts,
  });

  return id;
}

export async function getPendingApprovalById(id: string): Promise<PendingApproval | null> {
  const db = getFirestoreClient();
  const snap = await db.collection('pending_approvals').doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    id: snap.id,
    chatId: String(d.chatId),
    contactName: String(d.contactName || ''),
    businessConnectionId: String(d.businessConnectionId || ''),
    replyToMessageId: Number(d.replyToMessageId || 0),
    incomingText: String(d.incomingText || ''),
    incomingMediaType: String(d.incomingMediaType || 'text'),
    draftReply: String(d.draftReply || ''),
    escalationReason: String(d.escalationReason || ''),
    confidenceScore: Number(d.confidenceScore || 0),
    status: (d.status as PendingApproval['status']) || 'pending',
    notificationMessageId: Number(d.notificationMessageId || 0),
    createdAtMs: Number(d.createdAtMs || 0),
    createdAt: asIsoString(d.createdAt),
    updatedAt: asIsoString(d.updatedAt),
  };
}

export async function updatePendingApproval(
  id: string,
  updates: { status?: PendingApproval['status']; notificationMessageId?: number }
): Promise<void> {
  const db = getFirestoreClient();
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.notificationMessageId !== undefined) {
    patch.notificationMessageId = updates.notificationMessageId;
  }
  await db.collection('pending_approvals').doc(id).set(patch, { merge: true });
}

export async function countPendingApprovals(): Promise<number> {
  const db = getFirestoreClient();
  const snap = await db.collection('pending_approvals').where('status', '==', 'pending').count().get();
  return snap.data().count;
}

function mapQueueJobDoc(id: string, d: Record<string, unknown>): QueueJob {
  return {
    id,
    channel: (d.channel as ChatChannel) || 'business_chat',
    chatId: String(d.chatId || ''),
    messageId: Number(d.messageId || 0),
    payloadJson: String(d.payloadJson || '{}'),
    status: (d.status as QueueJob['status']) || 'queued',
    attempts: Number(d.attempts || 0),
    workerId: String(d.workerId || ''),
    leaseExpiresAtMs: Number(d.leaseExpiresAtMs || 0),
    nextAttemptAtMs: Number(d.nextAttemptAtMs || 0),
    deliveryState:
      d.deliveryState === 'delivered' || d.deliveryState === 'uncertain' ? d.deliveryState : 'pending',
    sentTelegramMessageId: Number(d.sentTelegramMessageId || 0),
    sentMediaType: String(d.sentMediaType || ''),
    lastError: String(d.lastError || ''),
    createdAtMs: Number(d.createdAtMs || 0),
    createdAt: asIsoString(d.createdAt),
    updatedAt: asIsoString(d.updatedAt),
  };
}

export async function enqueueJob(params: {
  channel: ChatChannel;
  chatId: string;
  messageId: number;
  payload: unknown;
}): Promise<string> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const nowMs = Date.now();
    const ts = nowIso();
    await db.collection('message_queue').doc(id).set({
      channel: params.channel,
      chatId: params.chatId,
      messageId: params.messageId,
      payloadJson: JSON.stringify(params.payload),
      status: 'queued',
      attempts: 0,
      workerId: '',
      leaseExpiresAtMs: 0,
      nextAttemptAtMs: nowMs,
      deliveryState: 'pending',
      sentTelegramMessageId: 0,
      sentMediaType: '',
      lastError: '',
      createdAtMs: nowMs,
      createdAt: ts,
      updatedAt: ts,
    });
    return id;
  });
}

export async function fetchQueuedJobs(limit = 10): Promise<QueueJob[]> {
  return withFirestoreRetry(async () => {
    const db = getFirestoreClient();
    const snap = await db
      .collection('message_queue')
      .where('status', '==', 'queued')
      .orderBy('createdAtMs', 'asc')
      .limit(limit)
      .get();

    return snap.docs.map((docSnap) => mapQueueJobDoc(docSnap.id, docSnap.data()));
  });
}

export async function claimQueuedJobs(params: {
  workerId: string;
  limit?: number;
  leaseDurationMs?: number;
}): Promise<QueueJob[]> {
  const limit = params.limit ?? 5;
  const leaseDurationMs = params.leaseDurationMs ?? 90_000;
  const db = getFirestoreClient();
  const nowMs = Date.now();

  const [queuedSnap, expiredSnap] = await Promise.all([
    db
      .collection('message_queue')
      .where('status', '==', 'queued')
      .orderBy('createdAtMs', 'asc')
      .limit(limit * 3)
      .get(),
    db
      .collection('message_queue')
      .where('status', '==', 'processing')
      .where('leaseExpiresAtMs', '<', nowMs)
      .orderBy('leaseExpiresAtMs', 'asc')
      .limit(limit)
      .get(),
  ]);

  const candidates = [
    ...expiredSnap.docs,
    ...queuedSnap.docs.filter((doc) => Number(doc.data().nextAttemptAtMs || 0) <= nowMs),
  ].slice(0, limit);

  const claimed: QueueJob[] = [];
  for (const cand of candidates) {
    try {
      const locked = await db.runTransaction(async (tx) => {
        const snap = await tx.get(cand.ref);
        if (!snap.exists) return null;
        const d = snap.data()!;
        const status = String(d.status || 'queued');
        const nextAttempt = Number(d.nextAttemptAtMs || 0);
        const leaseExp = Number(d.leaseExpiresAtMs || 0);

        const isReadyQueued = status === 'queued' && nextAttempt <= nowMs;
        const isExpiredLease = status === 'processing' && leaseExp > 0 && leaseExp < nowMs;
        if (!isReadyQueued && !isExpiredLease) {
          return null;
        }

        const nextAttempts = Number(d.attempts || 0) + 1;
        const newLeaseExp = nowMs + leaseDurationMs;
        const ts = nowIso();
        tx.set(
          cand.ref,
          {
            status: 'processing',
            workerId: params.workerId,
            leaseExpiresAtMs: newLeaseExp,
            attempts: nextAttempts,
            updatedAt: ts,
          },
          { merge: true }
        );

        return mapQueueJobDoc(snap.id, {
          ...d,
          status: 'processing',
          workerId: params.workerId,
          leaseExpiresAtMs: newLeaseExp,
          attempts: nextAttempts,
          updatedAt: ts,
        });
      });

      if (locked) {
        claimed.push(locked);
      }
    } catch {
      // Another worker contended on the same transaction; skip cleanly
    }
  }

  return claimed;
}

export async function markQueueJobDelivered(
  id: string,
  delivery: { sentTelegramMessageId: number; sentMediaType: string }
): Promise<void> {
  await withFirestoreRetry(() =>
    getFirestoreClient()
      .collection('message_queue')
      .doc(id)
      .set(
        {
          deliveryState: 'delivered',
          sentTelegramMessageId: delivery.sentTelegramMessageId,
          sentMediaType: delivery.sentMediaType.slice(0, 24),
          updatedAt: nowIso(),
        },
        { merge: true }
      )
  );
}

export async function scheduleQueueJobRetry(
  id: string,
  params: { attempts: number; nextAttemptAtMs: number; lastError: string }
): Promise<void> {
  await withFirestoreRetry(() =>
    getFirestoreClient()
      .collection('message_queue')
      .doc(id)
      .set(
        {
          status: 'queued',
          workerId: '',
          leaseExpiresAtMs: 0,
          attempts: params.attempts,
          nextAttemptAtMs: params.nextAttemptAtMs,
          lastError: sanitizeForLog(params.lastError).slice(0, 1000),
          updatedAt: nowIso(),
        },
        { merge: true }
      )
  );
}

export async function updateQueueJobStatus(
  id: string,
  updates: { status: QueueJob['status']; attempts?: number; lastError?: string }
): Promise<void> {
  const db = getFirestoreClient();
  const patch: Record<string, unknown> = {
    status: updates.status,
    updatedAt: nowIso(),
  };
  if (updates.status !== 'processing') {
    patch.workerId = '';
    patch.leaseExpiresAtMs = 0;
  }
  if (updates.attempts !== undefined) patch.attempts = updates.attempts;
  if (updates.lastError !== undefined) patch.lastError = sanitizeForLog(updates.lastError).slice(0, 1000);
  await withFirestoreRetry(() => db.collection('message_queue').doc(id).set(patch, { merge: true }));
}

export async function getQueueMetrics(): Promise<{
  queued: number;
  processing: number;
  deadLetter: number;
  done: number;
}> {
  const db = getFirestoreClient();
  const col = db.collection('message_queue');
  const [qSnap, pSnap, dSnap, doneSnap] = await Promise.all([
    col.where('status', '==', 'queued').count().get(),
    col.where('status', '==', 'processing').count().get(),
    col.where('status', '==', 'dead_letter').count().get(),
    col.where('status', '==', 'done').count().get(),
  ]);
  return {
    queued: qSnap.data().count,
    processing: pSnap.data().count,
    deadLetter: dSnap.data().count,
    done: doneSnap.data().count,
  };
}

export async function writeAuditLog(params: {
  channel: ChatChannel | 'system';
  eventType: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  chatId?: string;
  summary: string;
  details?: string;
}): Promise<void> {
  const db = getFirestoreClient();
  const id = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await db.collection('audit_logs').doc(id).set({
    channel: params.channel,
    eventType: params.eventType.slice(0, 64),
    severity: params.severity,
    chatId: (params.chatId || '').slice(0, 64),
    summary: sanitizeForLog(params.summary).slice(0, 500),
    details: sanitizeForLog(params.details || '').slice(0, 2000),
    createdAtMs: Date.now(),
    createdAt: nowIso(),
  });
}

export async function getRecentAuditLogs(limit = 15): Promise<AuditLogEntry[]> {
  const db = getFirestoreClient();
  const snap = await db.collection('audit_logs').orderBy('createdAtMs', 'desc').limit(limit).get();
  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      channel: (d.channel as AuditLogEntry['channel']) || 'system',
      eventType: String(d.eventType || ''),
      severity: (d.severity as AuditLogEntry['severity']) || 'info',
      chatId: String(d.chatId || ''),
      summary: String(d.summary || ''),
      details: String(d.details || ''),
      createdAtMs: Number(d.createdAtMs || 0),
      createdAt: asIsoString(d.createdAt),
    };
  });
}
