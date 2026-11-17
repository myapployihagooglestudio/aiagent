import { GoogleGenAI, Type } from '@google/genai';
import type { ChatChannel, IntentAnalysis, QualityControlReview } from '../types.ts';
import { geminiQuotaManager } from './geminiQuotaManager.ts';
import { getThinkingConfigForModel } from './modelConfig.ts';
import { containsSensitiveSecret, sanitizeForLog } from './securityFilter.ts';

export interface QualityControlResult extends QualityControlReview {
  verifiedByModel: boolean;
  qcError?: string;
}

export function runLightweightQualityCheck(params: {
  mode: ChatChannel;
  inboundText: string;
  draftReply: string;
  intent: IntentAnalysis;
  disclosureEnabled: boolean;
  disclosureText: string;
  confidenceThreshold: number;
}): QualityControlResult {
  const issues: string[] = [];
  let revisedReply = (params.draftReply || '').trim();

  if (!revisedReply || revisedReply.length < 2) {
    return {
      passed: false,
      confidenceScore: 0,
      issues: ['empty_reply'],
      revisedReply: '',
      shouldEscalate: false,
      escalationReason: '',
      verifiedByModel: false,
    };
  }

  // Strip accidental system-instruction leakage or raw secret tokens
  const secretCheck = containsSensitiveSecret(revisedReply);
  if (secretCheck.hasSecret) {
    issues.push(`secret_redacted:${secretCheck.reasons.join(',')}`);
    revisedReply = sanitizeForLog(revisedReply);
  }

  if (/\bsystemInstruction\b|TELEGRAM_BOT_TOKEN|GEMINI_API_KEY/i.test(revisedReply)) {
    issues.push('internal_identifier_leak');
    revisedReply = revisedReply.replace(/systemInstruction|TELEGRAM_BOT_TOKEN|GEMINI_API_KEY/gi, '[redacted]');
  }

  // Verify Business chat AI disclosure if reply claims human identity
  if (
    params.mode === 'business_chat' &&
    params.disclosureEnabled &&
    /\b(?:i am a human|men insonman|я человек)\b/i.test(revisedReply)
  ) {
    issues.push('ai_disclosure_violation');
    revisedReply = `${revisedReply}\n(${params.disclosureText || 'AI yordamchi'})`;
  }

  // Check basic URL preservation if inbound contained a clean non-shortener URL that was asked to be quoted
  const score = issues.length === 0 ? Math.max(85, params.confidenceThreshold) : Math.max(60, params.confidenceThreshold - 15);
  return {
    passed: issues.length === 0 && score >= params.confidenceThreshold,
    confidenceScore: score,
    issues,
    revisedReply,
    shouldEscalate: false,
    escalationReason: '',
    verifiedByModel: false,
  };
}

export async function runQualityControlReview(params: {
  ai: GoogleGenAI;
  mode: ChatChannel;
  contactName: string;
  inboundText: string;
  draftReply: string;
  intent: IntentAnalysis;
  groundedFactsSummary: string;
  hasAttachments?: boolean;
  disclosureEnabled: boolean;
  disclosureText: string;
  confidenceThreshold: number;
}): Promise<QualityControlResult> {
  const light = runLightweightQualityCheck({
    mode: params.mode,
    inboundText: params.inboundText,
    draftReply: params.draftReply,
    intent: params.intent,
    disclosureEnabled: params.disclosureEnabled,
    disclosureText: params.disclosureText,
    confidenceThreshold: params.confidenceThreshold,
  });

  // Skip secondary LLM call for simple, low-risk ordinary messages to save quota and latency
  const requiresDeepQc =
    process.env.GEMINI_ALWAYS_QC === 'true' ||
    !light.passed ||
    Boolean(params.groundedFactsSummary) ||
    (params.mode === 'business_chat' &&
      (params.intent.tone === 'frustrated' ||
        params.intent.intent === 'complaint' ||
        params.intent.intent === 'sensitive_action'));

  if (!requiresDeepQc) {
    return light;
  }

  const prompt = [
    `Channel: ${params.mode}`,
    `Sender/Contact: ${params.contactName}`,
    `Expected Language: ${params.intent.detectedLanguage} | Tone: ${params.intent.tone}`,
    `Incoming Message:\n${params.inboundText.slice(0, 1800)}`,
    params.groundedFactsSummary
      ? `Verified Grounded Facts Available:\n${params.groundedFactsSummary.slice(0, 1800)}`
      : 'No external web-search facts attached.',
    `AI Disclosure Rule (Business Chat only): ${
      params.mode === 'business_chat' && params.disclosureEnabled
        ? `Must never claim to be human; identity marker if asked: "${params.disclosureText}"`
        : 'Direct owner mode'
    }`,
    `Draft Reply to Evaluate:\n${light.revisedReply}`,
  ].join('\n\n');

  try {
    const res = await geminiQuotaManager.execute({
      task: 'qc',
      fn: (model) =>
        params.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction:
              'You are the Quality Control Gate for OMNIA AI. Evaluate: (1) relevance & completeness, (2) accuracy without inventing Quranic verses, Hadith references, scholarly rulings, prices, schedules, or tool results, (3) language/script correctness (uz_new ş/ç/ö/ğ, uz_lat, uz_cyr, ru, en), (4) exact preservation of Arabic text, names, URLs, emails, code blocks, numbers, (5) privacy & no secret leakage. Assign an honest confidenceScore (0-100). NEVER escalate ordinary greetings, Q&A, translations, or language switches.',
            ...(getThinkingConfigForModel(model, geminiQuotaManager.thinkingUnsupportedModels)
              ? { thinkingConfig: getThinkingConfigForModel(model, geminiQuotaManager.thinkingUnsupportedModels) }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                passed: { type: Type.BOOLEAN },
                confidenceScore: { type: Type.NUMBER },
                issues: { type: Type.ARRAY, items: { type: Type.STRING } },
                revisedReply: { type: Type.STRING },
                shouldEscalate: { type: Type.BOOLEAN },
                escalationReason: { type: Type.STRING },
              },
              required: [
                'passed',
                'confidenceScore',
                'issues',
                'revisedReply',
                'shouldEscalate',
                'escalationReason',
              ],
            },
          },
        }),
    });

    const parsed = JSON.parse((res.text || '{}').trim()) as QualityControlReview;
    const score =
      typeof parsed.confidenceScore === 'number' && Number.isFinite(parsed.confidenceScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.confidenceScore)))
        : 0;
    const revised = sanitizeForLog((parsed.revisedReply || '').trim() || light.revisedReply);

    return {
      passed: Boolean(parsed.passed) && score >= params.confidenceThreshold,
      confidenceScore: score,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [],
      revisedReply: revised,
      shouldEscalate: Boolean(parsed.shouldEscalate),
      escalationReason: (parsed.escalationReason || '').trim(),
      verifiedByModel: true,
    };
  } catch (err) {
    // NEVER fabricate a passing confidence score when model QC fails
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      confidenceScore: 0,
      issues: [...light.issues, 'qc_model_unavailable'],
      revisedReply: light.revisedReply,
      shouldEscalate: false,
      escalationReason: '',
      verifiedByModel: false,
      qcError: errMsg.slice(0, 200),
    };
  }
}
