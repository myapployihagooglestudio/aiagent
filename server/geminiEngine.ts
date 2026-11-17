import { generateIntelligentReply, isGeminiConfigured, type BrainAttachmentPart } from './ai/brain.ts';
import {
  analyzeVideoWithFfmpeg,
  generateRoundVideoNote,
  synthesizeVoiceNote,
  transcribeAudioBuffer,
} from './mediaPipeline.ts';
import type {
  EmojiLevel,
  LanguagePreference,
  ResponseStyle,
  SpeakingSpeed,
  TtsVoice,
  UILanguage,
  VerbosityMode,
  VoiceStyle,
} from './types.ts';

export {
  isGeminiConfigured,
  transcribeAudioBuffer,
  synthesizeVoiceNote,
  analyzeVideoWithFfmpeg,
  generateRoundVideoNote,
};

export interface DraftReplyInput {
  mode: 'bot_direct' | 'business_chat';
  chatId: string;
  personaPrompt: string;
  memorySummary?: string;
  defaultLanguage: LanguagePreference;
  uiLanguage: UILanguage;
  responseStyle: ResponseStyle;
  verbosityMode?: VerbosityMode;
  emojiLevel?: EmojiLevel;
  customStyleExamples?: string;
  disclosureEnabled: boolean;
  disclosureText?: string;
  confidenceThreshold?: number;
  escalationKeywords?: string;
  contactName: string;
  contactStyleOverride?: string;
  contactNotes?: string;
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'owner'; text: string }>;
  inboundText: string;
  attachments?: BrainAttachmentPart[];
}

export interface DraftReplyResult {
  replyText: string;
  detectedLanguage: string;
  intent: string;
  confidenceScore: number;
  shouldEscalate: boolean;
  escalationReason: string;
  safetyBlocked: boolean;
  qcPassed: boolean;
}

export async function generateAssistantReply(input: DraftReplyInput): Promise<DraftReplyResult> {
  const result = await generateIntelligentReply({
    mode: input.mode,
    chatId: input.chatId,
    personaPrompt: input.personaPrompt,
    legacyMemorySummary: input.memorySummary,
    defaultLanguage: input.defaultLanguage,
    uiLanguage: input.uiLanguage,
    responseStyle: input.responseStyle,
    verbosityMode: input.verbosityMode || 'balanced',
    emojiLevel: input.emojiLevel || 'subtle',
    customStyleExamples: input.customStyleExamples,
    disclosureEnabled: input.disclosureEnabled,
    disclosureText: input.disclosureText,
    confidenceThreshold: input.confidenceThreshold ?? 70,
    escalationKeywords: input.escalationKeywords,
    contactName: input.contactName,
    contactStyleOverride: input.contactStyleOverride,
    contactNotes: input.contactNotes,
    conversationHistory: input.conversationHistory,
    inboundText: input.inboundText,
    attachments: input.attachments,
  });

  return {
    replyText: result.replyText,
    detectedLanguage: result.detectedLanguage,
    intent: result.intent,
    confidenceScore: result.confidenceScore,
    shouldEscalate: result.shouldEscalate,
    escalationReason: result.escalationReason,
    safetyBlocked: result.safetyBlocked,
    qcPassed: result.qcPassed,
  };
}

export type VoiceConfigTuple = {
  ttsVoice: TtsVoice;
  voiceStyle: VoiceStyle;
  speakingSpeed: SpeakingSpeed;
};
