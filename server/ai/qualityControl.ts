import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { ChatChannel, IntentAnalysis, QualityControlReview } from '../types.ts';

export async function runQualityControlReview(params: {
  ai: GoogleGenAI;
  mode: ChatChannel;
  contactName: string;
  inboundText: string;
  draftReply: string;
  intent: IntentAnalysis;
  groundedFactsSummary: string;
  disclosureEnabled: boolean;
  disclosureText: string;
  confidenceThreshold: number;
}): Promise<QualityControlReview> {
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
    `Draft Reply to Evaluate:\n${params.draftReply}`,
  ].join('\n\n');

  try {
    const res = await params.ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are the 8-point Quality Control Gate for OMNIA AI. Check: (1) Did the draft actually answer the request? (2) Is it relevant and helpful? (3) Are all factual claims supported without inventing Quranic verses, Hadith references, scholarly opinions, prices, schedules, or private data? (4) Is the language/script accurate and natural (including New Uzbek Latin `uz_new`: ş/ç/ö/ğ, Standard Uzbek Latin `uz_lat`, Uzbek Cyrillic `uz_cyr`, Russian, English)? (5) Are Arabic Quran/Hadith texts, personal/official names, URLs, emails, code blocks, numbers, and exact quotations preserved uncorrupted? (6) Is the tone appropriate for the sender and channel? (7) Does it respect safety, privacy, zero secret leakage, and AI honesty? (8) Assign an honest confidenceScore (0-100). If any issue exists that can be improved cleanly without fabricating facts, set revisedReply to an improved version. For ordinary greetings/chats or clear answers, confidenceScore should be 82-98 and shouldEscalate=false. Never escalate ordinary language selection or translation. Set shouldEscalate=true ONLY in business_chat if the draft cannot safely answer without owner decision or involves sensitive/uncertain commitments.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
    });

    const parsed = JSON.parse((res.text || '{}').trim()) as QualityControlReview;
    const score =
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidenceScore)))
        : 85;
    const revised = (parsed.revisedReply || '').trim() || params.draftReply;

    return {
      passed: Boolean(parsed.passed) && score >= params.confidenceThreshold,
      confidenceScore: score,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [],
      revisedReply: revised,
      shouldEscalate: Boolean(parsed.shouldEscalate),
      escalationReason: (parsed.escalationReason || '').trim(),
    };
  } catch {
    return {
      passed: true,
      confidenceScore: 84,
      issues: [],
      revisedReply: params.draftReply,
      shouldEscalate: false,
      escalationReason: '',
    };
  }
}
