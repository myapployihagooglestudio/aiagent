export type UILanguage = 'uz_lat' | 'uz_cyr' | 'uz_new' | 'ru' | 'en';
export type LanguagePreference = 'auto' | UILanguage;
export type ResponseStyle = 'concise' | 'warm' | 'executive' | 'formal';
export type AutoReplyMode = 'autonomous' | 'manual_approval' | 'off';
export type TtsVoice = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
export type VoiceStyle = 'calm' | 'warm' | 'energetic' | 'formal';
export type SpeakingSpeed = 'slow' | 'normal' | 'fast';
export type VoiceOutputMode = 'text' | 'voice' | 'both';
export type VerbosityMode = 'short' | 'balanced' | 'detailed';
export type EmojiLevel = 'none' | 'subtle' | 'expressive';
export type ChatChannel = 'bot_direct' | 'business_chat';
export type ChatPermission = 'allow' | 'manual_approve' | 'exclude';

export interface UserLanguagePreference {
  userId: string;
  preferredLanguage: LanguagePreference;
  uiLanguage: UILanguage;
  username: string;
  displayName: string;
  updatedAt: string;
}

export type MemoryType =
  | 'preference'
  | 'style'
  | 'owner_fact'
  | 'task'
  | 'summary'
  | 'chat_context'
  | 'instruction'
  | 'temp';

export type MemoryScope = 'owner' | 'chat';

export interface BotSettings {
  uiLanguage: UILanguage;
  defaultReplyLanguage: LanguagePreference;
  responseStyle: ResponseStyle;
  verbosityMode: VerbosityMode;
  emojiLevel: EmojiLevel;
  customStyleExamples: string;
  autoReplyMode: AutoReplyMode;
  autonomousEnabled: boolean;
  paused: boolean;
  botPaused: boolean;
  businessPaused: boolean;
  emergencyStop: boolean;
  voiceReplyEnabled: boolean;
  voiceOutputMode: VoiceOutputMode;
  ttsVoice: TtsVoice;
  voiceStyle: VoiceStyle;
  speakingSpeed: SpeakingSpeed;
  autoTranscribeVoice: boolean;
  autoAnalyzeVideo: boolean;
  videoReplyEnabled: boolean;
  callsEnabled: boolean;
  aiConsentConfirmed: boolean;
  disclosureEnabled: boolean;
  disclosureText: string;
  confidenceThreshold: number;
  rateLimitPerMinute: number;
  personaPrompt: string;
  memorySummary: string;
  escalationKeywords: string;
  ownerTelegramId: number;
  ownerUsername: string;
  businessConnectionId: string;
  connectionEnabled: boolean;
  businessOwnerId: number;
  businessOwnerName: string;
  rightsCanReply: boolean;
  rightsCanReadMessages: boolean;
  rightsCanDeleteSent: boolean;
  lastWebhookAt: string;
  lastWebhookEvent: string;
  updatedAt: string;
}

export interface ChatRule {
  chatId: string;
  channel: ChatChannel;
  contactName: string;
  username: string;
  permission: ChatPermission;
  aiConsentGranted: boolean;
  styleOverride: string;
  notes: string;
  lastInboundAt: string | null;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  channel: ChatChannel | 'global';
  chatId: string;
  content: string;
  provenance: string;
  tags: string;
  expiresAtMs: number;
  createdAtMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  channel: ChatChannel;
  chatId: string;
  telegramMessageId: number;
  role: 'user' | 'assistant' | 'owner';
  mediaType: 'text' | 'voice' | 'photo' | 'video' | 'video_note' | 'document';
  text: string;
  transcript: string;
  status: 'received' | 'sent' | 'pending_approval' | 'rejected' | 'edited' | 'deleted' | 'failed';
  createdAt: string;
}

export interface PendingApproval {
  id: string;
  chatId: string;
  contactName: string;
  businessConnectionId: string;
  replyToMessageId: number;
  incomingText: string;
  incomingMediaType: string;
  draftReply: string;
  escalationReason: string;
  confidenceScore: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  notificationMessageId: number;
  createdAtMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  channel: ChatChannel | 'system';
  eventType: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  chatId: string;
  summary: string;
  details: string;
  createdAtMs: number;
  createdAt: string;
}

export interface QueueJob {
  id: string;
  channel: ChatChannel;
  chatId: string;
  messageId: number;
  payloadJson: string;
  status: 'queued' | 'processing' | 'done' | 'dead_letter';
  attempts: number;
  lastError: string;
  createdAtMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntentAnalysis {
  intent:
    | 'question'
    | 'request'
    | 'greeting'
    | 'joke'
    | 'complaint'
    | 'discussion'
    | 'factual_lookup'
    | 'sensitive_action'
    | 'memory_worthy';
  tone: 'casual' | 'polite' | 'urgent' | 'frustrated' | 'humorous' | 'formal';
  detectedLanguage: 'uz_lat' | 'uz_cyr' | 'uz_new' | 'ru' | 'en' | 'mixed_uz_ru';
  needsWebSearch: boolean;
  searchQuery: string;
  candidateMemoryFact: string;
  highRiskReason: string;
}

export interface QualityControlReview {
  passed: boolean;
  confidenceScore: number;
  issues: string[];
  revisedReply: string;
  shouldEscalate: boolean;
  escalationReason: string;
}

export interface SecurityInspectionResult {
  promptInjectionDetected: boolean;
  highRiskFinancialOrLegal: boolean;
  containsSecretOrOtp: boolean;
  suspiciousScamOrLink: boolean;
  matchedKeywords: string[];
  reasons: string[];
  riskLevel: 'low' | 'medium' | 'high';
}
