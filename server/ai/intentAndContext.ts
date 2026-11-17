import { GoogleGenAI, Type } from '@google/genai';
import type { ChatChannel, IntentAnalysis } from '../types.ts';
import { geminiQuotaManager } from './geminiQuotaManager.ts';
import { getThinkingConfigForModel } from './modelConfig.ts';
import { detectScriptAndLanguage, extractInformalUzbekHints } from './uzbekAndLanguage.ts';

const GREETING_RE =
  /^(?:assalomu alaykum|va alaykum|salom|slm|hello|hi|hey|привет|здравствуй(?:те)?|доброе утро|добрый день|добрый вечер|qalaysiz|qalesiz|yaxshimisiz)[!.,?\s]*$/iu;

const WEB_SEARCH_HINT_RE =
  /\b(?:bugun(?:gi)?\s+(?:ob-havo|kurs|narx|yangilik)|dollar\s+kurs|valyuta\s+kurs|ob-havo|so['‘]?nggi\s+yangilik|hozirgi\s+narx|latest\s+news|weather\s+(?:in|today)|exchange\s+rate|stock\s+price|курс\s+(?:доллара|валют)|погода\s+сегодня|последние\s+новости)\b/iu;

const FACTUAL_MEMORY_HINT_RE =
  /\b(?:mening ismim|men\s+\w+\s+da\s+ishlayman|eslab qol|yodingda tut|my name is|remember that|меня зовут|запомни)\b/iu;

export function analyzeIntentHeuristically(params: {
  text: string;
  mediaLabel?: string;
}): IntentAnalysis {
  const clean = (params.text || '').trim();
  const detectedLanguage = detectScriptAndLanguage(clean);

  let intent: IntentAnalysis['intent'] = 'question';
  if (GREETING_RE.test(clean)) {
    intent = 'greeting';
  } else if (FACTUAL_MEMORY_HINT_RE.test(clean)) {
    intent = 'memory_worthy';
  } else if (WEB_SEARCH_HINT_RE.test(clean)) {
    intent = 'factual_lookup';
  } else if (/\b(?:yordam|ilova|yozib ber|tarjima|qisqartir|translate|summarize|write|помоги|переведи)\b/iu.test(clean)) {
    intent = 'request';
  } else if (/[?]/.test(clean)) {
    intent = 'question';
  } else {
    intent = 'discussion';
  }

  let tone: IntentAnalysis['tone'] = 'polite';
  if (/\b(?:tezkor|shoshilinch|urgent|asap|срочно)\b/iu.test(clean)) {
    tone = 'urgent';
  } else if (/\b(?:shikoyat|yomon|ishlamayapti|xato|complaint|broken|не работает|жалоба)\b/iu.test(clean)) {
    tone = 'frustrated';
  } else if (/^(?:slm|qales|nma|hi|hey|привет)\b/iu.test(clean)) {
    tone = 'casual';
  }

  const needsWebSearch = WEB_SEARCH_HINT_RE.test(clean) && !params.mediaLabel;

  let candidateMemoryFact = '';
  if (intent === 'memory_worthy' && clean.length >= 8 && clean.length <= 240) {
    candidateMemoryFact = clean.slice(0, 220);
  }

  return {
    intent,
    tone,
    detectedLanguage,
    needsWebSearch,
    searchQuery: needsWebSearch ? clean.slice(0, 200) : '',
    candidateMemoryFact,
    highRiskReason: '',
  };
}

export async function analyzeIntentAndContext(params: {
  ai: GoogleGenAI;
  text: string;
  mediaLabel?: string;
  history: Array<{ role: string; text: string }>;
  mode: ChatChannel;
}): Promise<IntentAnalysis> {
  const heuristic = analyzeIntentHeuristically({
    text: params.text,
    mediaLabel: params.mediaLabel,
  });

  // Zero-extra-API-call fast path by default to protect free-tier quota and latency.
  // Enable GEMINI_LLM_INTENT=true only if explicit secondary LLM intent pass is desired.
  if (process.env.GEMINI_LLM_INTENT !== 'true') {
    return heuristic;
  }

  const slangHint = extractInformalUzbekHints(params.text);
  const recentSnippet = params.history
    .slice(-5)
    .map((m) => `${m.role}: ${m.text.slice(0, 180)}`)
    .join('\n');

  const prompt = [
    `Channel mode: ${params.mode}`,
    `Heuristic language: ${heuristic.detectedLanguage}`,
    slangHint,
    params.mediaLabel ? `Media attached: ${params.mediaLabel}` : '',
    recentSnippet ? `Recent context:\n${recentSnippet}` : '',
    `Current message:\n${params.text.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const res = await geminiQuotaManager.execute({
      task: 'intent',
      fn: (model) =>
        params.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction:
              'Classify intent, tone, language, and web-search need for an Uzbek (uz_lat, uz_cyr, uz_new), Russian, and English Telegram AI agent. Leave highRiskReason empty for ordinary greetings, casual chats, or educational/general questions; set highRiskReason ONLY for actionable financial transfers, legal commitments, credential/OTP sharing, or irreversible destructive actions.',
            ...(getThinkingConfigForModel(model, geminiQuotaManager.thinkingUnsupportedModels)
              ? { thinkingConfig: getThinkingConfigForModel(model, geminiQuotaManager.thinkingUnsupportedModels) }
              : {}),
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
        }),
    });

    const parsed = JSON.parse((res.text || '{}').trim()) as IntentAnalysis;
    return {
      intent: parsed.intent || heuristic.intent,
      tone: parsed.tone || heuristic.tone,
      detectedLanguage: parsed.detectedLanguage || heuristic.detectedLanguage,
      needsWebSearch: Boolean(parsed.needsWebSearch),
      searchQuery: (parsed.searchQuery || '').trim(),
      candidateMemoryFact: (parsed.candidateMemoryFact || '').trim(),
      highRiskReason: (parsed.highRiskReason || '').trim(),
    };
  } catch {
    return heuristic;
  }
}
