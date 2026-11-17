import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { ChatChannel, IntentAnalysis } from '../types.ts';
import { detectScriptAndLanguage, extractInformalUzbekHints } from './uzbekAndLanguage.ts';

export async function analyzeIntentAndContext(params: {
  ai: GoogleGenAI;
  text: string;
  mediaLabel?: string;
  history: Array<{ role: string; text: string }>;
  mode: ChatChannel;
}): Promise<IntentAnalysis> {
  const heuristicLang = detectScriptAndLanguage(params.text);
  const slangHint = extractInformalUzbekHints(params.text);
  const recentSnippet = params.history
    .slice(-5)
    .map((m) => `${m.role}: ${m.text.slice(0, 180)}`)
    .join('\n');

  const prompt = [
    `Channel mode: ${params.mode}`,
    `Heuristic language: ${heuristicLang}`,
    slangHint,
    params.mediaLabel ? `Media attached: ${params.mediaLabel}` : '',
    recentSnippet ? `Recent context:\n${recentSnippet}` : '',
    `Current message:\n${params.text.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const res = await params.ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an intent, tone, language, and web-search classifier for an Uzbek (Standard Latin uz_lat, Cyrillic uz_cyr, New Uzbek Latin uz_new with ş/ç/ö/ğ), Russian, and English Telegram AI agent. Classify accurately without inventing information. Set needsWebSearch=true ONLY if answering accurately requires live/recent real-world web facts (news, currency rates, weather, prices, schedules, public people/events not in chat context). Keep candidateMemoryFact empty unless there is a clear durable preference, ongoing task, or owner/contact fact (NEVER store passwords, OTPs, card numbers, or rumors). Leave highRiskReason empty for ordinary greetings, casual chats, or general questions; set highRiskReason ONLY for financial transfers, legal/contract commitments, password/OTP requests, or irreversible account actions.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING,
              enum: [
                'question',
                'request',
                'greeting',
                'joke',
                'complaint',
                'discussion',
                'factual_lookup',
                'sensitive_action',
                'memory_worthy',
              ],
            },
            tone: {
              type: Type.STRING,
              enum: ['casual', 'polite', 'urgent', 'frustrated', 'humorous', 'formal'],
            },
            detectedLanguage: {
              type: Type.STRING,
              enum: ['uz_lat', 'uz_cyr', 'uz_new', 'ru', 'en', 'mixed_uz_ru'],
            },
            needsWebSearch: { type: Type.BOOLEAN },
            searchQuery: { type: Type.STRING },
            candidateMemoryFact: { type: Type.STRING },
            highRiskReason: { type: Type.STRING },
          },
          required: [
            'intent',
            'tone',
            'detectedLanguage',
            'needsWebSearch',
            'searchQuery',
            'candidateMemoryFact',
            'highRiskReason',
          ],
        },
      },
    });

    const parsed = JSON.parse((res.text || '{}').trim()) as IntentAnalysis;
    return {
      intent: parsed.intent || 'question',
      tone: parsed.tone || 'polite',
      detectedLanguage: parsed.detectedLanguage || heuristicLang,
      needsWebSearch: Boolean(parsed.needsWebSearch),
      searchQuery: (parsed.searchQuery || '').trim(),
      candidateMemoryFact: (parsed.candidateMemoryFact || '').trim(),
      highRiskReason: (parsed.highRiskReason || '').trim(),
    };
  } catch {
    return {
      intent: 'question',
      tone: 'polite',
      detectedLanguage: heuristicLang,
      needsWebSearch: false,
      searchQuery: '',
      candidateMemoryFact: '',
      highRiskReason: '',
    };
  }
}
