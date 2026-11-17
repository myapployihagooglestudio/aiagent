import type { UILanguage } from '../types.ts';

export type DetectedLangCode = 'uz_lat' | 'uz_cyr' | 'uz_new' | 'ru' | 'en' | 'mixed_uz_ru';

const NEW_UZBEK_CHARS_RE = /[şçöğŞÇÖĞ]/;
const UZ_CYRILLIC_SPECIFIC_RE = /[ўқғҳЎҚҒҲ]/;
const CYRILLIC_RE = /[а-яА-ЯёЁўқғҳЎҚҒҲ]/g;
const LATIN_RE = /[a-zA-ZşçöğŞÇÖĞ]/g;

// Includes standard Uzbek apostrophe variants: ASCII ', right/left curly ’ ‘, modifier ʼ, backtick `, acute ´, okina ʻ, prime ʹ ′
const APOSTROPHE_CLASS = `['’‘ʼ\`´ʻʹ′]`;

const UZ_LATIN_WORDS_RE =
  /(?<![\p{L}\p{N}])(?:salom|assalomu|alaykum|qalay|qalaysiz|nima|qancha|yaxshi|yaxşi|rahmat|raxmat|kerak|kere|bopti|böpti|xo'p|xöp|xop|ha|yo'q|yöq|yoq|bugun|ertaga|iltimos|yordam|men|siz|biz|uchun|uçun|bilan|qachon|qaçon|qayerda|qatta|aka|uka|opa|do'stim|döstim|shahar|şahar|chiroyli|çiroyli|o'zbek|özbek|to'g'ri|töğri)(?![\p{L}\p{N}])/giu;

const UZ_CYR_WORDS_RE =
  /(?<![\p{L}\p{N}])(?:салом|ассалому|алайкум|рахмат|яхши|нима|қанча|керак|борми|йўқ|бугун|эртага|илтимос|қалай|мен|сиз|учун|билан|ўзбек)(?![\p{L}\p{N}])/giu;

const RU_WORDS_RE =
  /(?<![\p{L}\p{N}])(?:привет|здравствуйте|спасибо|пожалуйста|сколько|когда|можно|нужно|хорошо|сегодня|завтра|помоги|давай|ладно|почему|как|что|где|встреча|во)(?![\p{L}\p{N}])/giu;

const EN_WORDS_RE =
  /\b(?:hello|hi|please|thanks|thank|how|what|when|where|why|can|could|would|today|tomorrow|help|good|okay|meeting|schedule)\b/gi;

export function detectScriptAndLanguage(text: string): DetectedLangCode {
  const sample = (text || '').trim();
  if (!sample) return 'uz_lat';

  const cyrMatches = sample.match(CYRILLIC_RE)?.length ?? 0;
  const latMatches = sample.match(LATIN_RE)?.length ?? 0;
  const hasNewUzbekChars = NEW_UZBEK_CHARS_RE.test(sample);
  const uzLatHits = sample.match(UZ_LATIN_WORDS_RE)?.length ?? 0;
  const uzCyrHits = sample.match(UZ_CYR_WORDS_RE)?.length ?? 0;
  const ruHits = sample.match(RU_WORDS_RE)?.length ?? 0;
  const enHits = sample.match(EN_WORDS_RE)?.length ?? 0;

  // Mixed Uzbek (any script) + Russian
  if ((uzLatHits > 0 || hasNewUzbekChars || uzCyrHits > 0) && ruHits > 0 && cyrMatches > 0) {
    // Distinguish pure Uzbek Cyrillic from mixed Uzbek+Russian
    if (latMatches > 0 || (uzCyrHits > 0 && ruHits > 0)) {
      return 'mixed_uz_ru';
    }
  }

  if (cyrMatches > latMatches) {
    if (UZ_CYRILLIC_SPECIFIC_RE.test(sample) || uzCyrHits > ruHits) return 'uz_cyr';
    return 'ru';
  }

  if (hasNewUzbekChars) {
    return 'uz_new';
  }

  if (uzLatHits >= enHits && uzLatHits > 0) return 'uz_lat';
  if (enHits > uzLatHits && latMatches > 0) return 'en';
  if (new RegExp(`[oOgG]${APOSTROPHE_CLASS}`).test(sample) || /\b(?:sh|ch)\w+/i.test(sample)) {
    return 'uz_lat';
  }
  return 'uz_lat';
}

const SLANG_HINTS: Array<[RegExp, string]> = [
  [/\bslm\b/gi, 'salom'],
  [/\bqales(?:iz)?\b/gi, 'qalaysiz'],
  [/\bqatta\b/gi, 'qayerda'],
  [/\bnma\b/gi, 'nima'],
  [/\b(?:kk|kere)\b/gi, 'kerak'],
  [/\bbopti\b/gi, "bo'pti"],
  [/\braxmat\b/gi, 'rahmat'],
  [/\bvoaleykum\b/gi, 'va alaykum assalom'],
  [/\bxp\b/gi, "xo'p"],
  [/\bxop\b/gi, "xo'p"],
];

export function extractInformalUzbekHints(text: string): string {
  let normalized = text;
  const notes: string[] = [];
  for (const [re, replacement] of SLANG_HINTS) {
    if (re.test(normalized)) {
      notes.push(`${re.source.replace(/\\b/g, '')} -> ${replacement}`);
      normalized = normalized.replace(re, replacement);
    }
  }
  if (notes.length === 0) return '';
  return `Informal Uzbek normalization: "${normalized}"`;
}

// Protected spans (IMPORTANT: outer single capturing group only; all inner groups must be non-capturing (?:...))
// Preserves: fenced code blocks, inline code, URLs, emails, @mentions, #hashtags,
// Arabic Quranic/Hadith unicode runs, brand/tech words, and common English loanwords with sh/ch.
const PROTECTED_SPAN_RE =
  /(```[\s\S]*?```|(?<![A-Za-z0-9])`[^`\n]+`(?![A-Za-z0-9])|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[\w.+-]+@[\w-]+\.[\w.-]+|@[A-Za-z0-9_]+|#[A-Za-z0-9_]+|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[\s\u0640]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*|\b(?:Assalomu alaykum|Va alaykum assalom|Inshaalloh|Alhamdulillah|Mashalloh|Subhanalloh|Bismillah|Ассалому алайкум|Иншааллоҳ|Алҳамдулиллаҳ|OMNIA AI|Telegram|Gemini|Google|WhatsApp|TypeScript|JavaScript|Firestore|Cloud Run|Webhook|ChatGPT|YouTube|GitHub|Android|iPhone|Dashboard|Bluetooth|English|Russian|Turkish|French|Spanish|Push|Flash|Search|Cache|Check|Channel|Switch|Patch|Match|Batch|Branch|Launch|Chrome|Shell|Bash|Hash|SSH|HTTPS)\b)/gi;

const LAT_TO_CYR_DIGRAPHS: Array<[RegExp, string]> = [
  [new RegExp(`O${APOSTROPHE_CLASS}`, 'g'), 'Ў'],
  [new RegExp(`o${APOSTROPHE_CLASS}`, 'g'), 'ў'],
  [new RegExp(`G${APOSTROPHE_CLASS}`, 'g'), 'Ғ'],
  [new RegExp(`g${APOSTROPHE_CLASS}`, 'g'), 'ғ'],
  [/SH/g, 'Ш'],
  [/Sh/g, 'Ш'],
  [/sH/g, 'ш'],
  [/sh/g, 'ш'],
  [/CH/g, 'Ч'],
  [/Ch/g, 'Ч'],
  [/cH/g, 'ч'],
  [/ch/g, 'ч'],
  [/Ya/g, 'Я'],
  [/ya/g, 'я'],
  [/Yo/g, 'Ё'],
  [/yo/g, 'ё'],
  [/Yu/g, 'Ю'],
  [/yu/g, 'ю'],
  [/Ye/g, 'Е'],
  [/ye/g, 'е'],
  [/Ts/g, 'Ц'],
  [/ts/g, 'ц'],
  [/Ng/g, 'Нг'],
  [/ng/g, 'нг'],
];

const LAT_TO_CYR_CHARS: Record<string, string> = {
  A: 'А', a: 'а', B: 'Б', b: 'б', D: 'Д', d: 'д', E: 'Э', e: 'е',
  F: 'Ф', f: 'ф', G: 'Г', g: 'г', H: 'Ҳ', h: 'ҳ', I: 'И', i: 'и',
  J: 'Ж', j: 'ж', K: 'К', k: 'к', L: 'Л', l: 'л', M: 'М', m: 'м',
  N: 'Н', n: 'н', O: 'О', o: 'о', P: 'П', p: 'п', Q: 'Қ', q: 'қ',
  R: 'Р', r: 'р', S: 'С', s: 'с', T: 'Т', t: 'т', U: 'У', u: 'у',
  V: 'В', v: 'в', X: 'Х', x: 'х', Y: 'Й', y: 'й', Z: 'З', z: 'з',
};

const CYR_TO_LAT_CHARS: Record<string, string> = {
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g',
  Д: 'D', д: 'd', Е: 'E', е: 'e', Ё: 'Yo', ё: 'yo', Ж: 'J', ж: 'j',
  З: 'Z', з: 'z', И: 'I', и: 'i', Й: 'Y', й: 'y', К: 'K', к: 'k',
  Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o',
  П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
  У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'X', х: 'x', Ц: 'Ts', ц: 'ts',
  Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Ъ: "'", ъ: "'", Ы: 'I', ы: 'i',
  Ь: '', ь: '', Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya',
  Ў: 'O‘', ў: 'o‘', Қ: 'Q', қ: 'q', Ғ: 'G‘', ғ: 'g‘', Ҳ: 'H', ҳ: 'h',
};

const O_APOS_UPPER_RE = new RegExp(`O${APOSTROPHE_CLASS}`, 'g');
const O_APOS_LOWER_RE = new RegExp(`o${APOSTROPHE_CLASS}`, 'g');
const G_APOS_UPPER_RE = new RegExp(`G${APOSTROPHE_CLASS}`, 'g');
const G_APOS_LOWER_RE = new RegExp(`g${APOSTROPHE_CLASS}`, 'g');
const ALL_APOS_IN_LAT_RE = new RegExp(APOSTROPHE_CLASS, 'g');

function convertSegmentLatToNew(seg: string): string {
  return seg
    .replace(O_APOS_UPPER_RE, 'Ö')
    .replace(O_APOS_LOWER_RE, 'ö')
    .replace(G_APOS_UPPER_RE, 'Ğ')
    .replace(G_APOS_LOWER_RE, 'ğ')
    .replace(/SH/g, 'Ş')
    .replace(/Sh/g, 'Ş')
    .replace(/sH/g, 'Ş')
    .replace(/sh/g, 'ş')
    .replace(/CH/g, 'Ç')
    .replace(/Ch/g, 'Ç')
    .replace(/cH/g, 'Ç')
    .replace(/ch/g, 'ç');
}

function isUpperChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-ZŞÇÖĞ]/.test(ch));
}

function convertSegmentNewToLat(seg: string): string {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    const prev = seg[i - 1];
    const next = seg[i + 1];

    if (ch === 'Ş') {
      out += isUpperChar(prev) || isUpperChar(next) ? 'SH' : 'Sh';
    } else if (ch === 'ş') {
      out += 'sh';
    } else if (ch === 'Ç') {
      out += isUpperChar(prev) || isUpperChar(next) ? 'CH' : 'Ch';
    } else if (ch === 'ç') {
      out += 'ch';
    } else if (ch === 'Ö') {
      out += 'O‘';
    } else if (ch === 'ö') {
      out += 'o‘';
    } else if (ch === 'Ğ') {
      out += 'G‘';
    } else if (ch === 'ğ') {
      out += 'g‘';
    } else {
      out += ch;
    }
  }
  return out;
}

function convertSegmentLatToCyr(seg: string): string {
  // If segment has New Uzbek chars first normalize New -> Lat cleanly
  let out = NEW_UZBEK_CHARS_RE.test(seg) ? convertSegmentNewToLat(seg) : seg;
  for (const [re, rep] of LAT_TO_CYR_DIGRAPHS) {
    out = out.replace(re, rep);
  }
  out = out.replace(/(^|\s)e/g, '$1э').replace(/(^|\s)E/g, '$1Э');
  out = out.replace(ALL_APOS_IN_LAT_RE, 'ъ');
  return [...out].map((ch) => LAT_TO_CYR_CHARS[ch] ?? ch).join('');
}

function convertSegmentCyrToLat(seg: string): string {
  return [...seg].map((ch) => CYR_TO_LAT_CHARS[ch] ?? ch).join('');
}

export type TransliterationTarget = 'uz_lat' | 'uz_cyr' | 'uz_new';

export function transliterateUzbek(
  text: string,
  target: TransliterationTarget | UILanguage
): string {
  if (!text) return '';
  if (target === 'ru' || target === 'en') return text;

  const parts = text.split(PROTECTED_SPAN_RE);
  return parts
    .map((part, idx) => {
      // Odd indices are exact preserved protected spans
      if (idx % 2 === 1) return part;

      if (target === 'uz_new') {
        const hasCyr = /[а-яА-ЯёЁўқғҳЎҚҒҲ]/.test(part);
        const latBase = hasCyr ? convertSegmentCyrToLat(part) : part;
        return convertSegmentLatToNew(latBase);
      }

      if (target === 'uz_cyr') {
        return convertSegmentLatToCyr(part);
      }

      // target === 'uz_lat'
      const fromNew = NEW_UZBEK_CHARS_RE.test(part) ? convertSegmentNewToLat(part) : part;
      return /[а-яА-ЯёЁўқғҳЎҚҒҲ]/.test(fromNew) ? convertSegmentCyrToLat(fromNew) : fromNew;
    })
    .join('');
}

export function toNewUzbekLatin(text: string): string {
  return transliterateUzbek(text, 'uz_new');
}

export function fromNewUzbekLatin(text: string): string {
  return transliterateUzbek(text, 'uz_lat');
}
