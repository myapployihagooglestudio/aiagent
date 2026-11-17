import type { SecurityInspectionResult } from '../types.ts';

const TELEGRAM_TOKEN_RE = /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/g;
const GEMINI_KEY_RE = /\bAIza[0-9A-Za-z_-]{25,}\b/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
const CARD_NUMBER_RE = /\b(?:\d[ -]*?){16}\b/g;
const TELEGRAM_OTP_RE = /\b(?:login code|tasdiqlash kodi|код подтверждения|verification code|otp|pin)[:\s-]*\d{4,8}\b/gi;

export function sanitizeForLog(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(TELEGRAM_TOKEN_RE, '[REDACTED_BOT_TOKEN]')
    .replace(GEMINI_KEY_RE, '[REDACTED_API_KEY]')
    .replace(BEARER_RE, 'Bearer [REDACTED_TOKEN]')
    .replace(CARD_NUMBER_RE, '[REDACTED_CARD]')
    .replace(TELEGRAM_OTP_RE, '[REDACTED_OTP]');
}

const SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'telegram_bot_token', regex: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
  { label: 'api_key', regex: /\b(?:AIza[0-9A-Za-z_-]{25,}|sk-[A-Za-z0-9_-]{20,})\b/ },
  { label: 'private_key_block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { label: 'bank_card_16d', regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/ },
  {
    label: 'password_or_otp',
    regex:
      /\b(?:mening |my |мой |аккаунт |hisob )?(?:parol(?:im)?|password|passcode|otp|cvv|cvc|pin[- ]?kod|tasdiqlash kodi|секретный код|пароль|код входа)\s*(?:is|=|:|-)\s*[A-Za-z0-9!@#$%^&*_-]{4,}/i,
  },
  {
    label: 'seed_phrase_hint',
    regex: /\b(?:seed phrase|recovery phrase|12 words|24 words|mnemonic)\b/i,
  },
];

export function containsSensitiveSecret(text: string): { hasSecret: boolean; reasons: string[] } {
  const clean = (text || '').trim();
  if (!clean) return { hasSecret: false, reasons: [] };

  const reasons: string[] = [];
  for (const p of SECRET_PATTERNS) {
    if (p.regex.test(clean)) {
      reasons.push(p.label);
    }
  }
  return { hasSecret: reasons.length > 0, reasons };
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any )?(?:previous|prior|above) instructions/i,
  /disregard (?:your )?(?:system|developer) prompt/i,
  /reveal (?:your )?(?:system prompt|api key|secret|env|token|memory of other)/i,
  /\byou are now (?:dan|developer mode|jailbroken|unrestricted)\b/i,
  /\boverride (?:safety|security|rules|restrictions)\b/i,
  /(?:oldingi|avvalgi) (?:ko['‘]rsatma|qoida|buyruq)larni (?:unut|bekor qil)/i,
  /(?:tizim|yashirin) (?:promt|ko['‘]rsatma|kalit|xotira)ni (?:ko['‘]rsat|ayt|ber)/i,
  /(?:забудь|игнорируй) (?:предыдущие|системные) (?:инструкции|правила)/i,
  /(?:покажи|раскрой) (?:системный промпт|секретный ключ|токен)/i,
];

// Genuine consequential/actionable patterns ONLY — NOT informational discussions
const ACTIONABLE_HIGH_RISK_PATTERNS: RegExp[] = [
  // Financial transfers / direct payment execution requests
  /\b(?:send|transfer|wire|pay|remit)\s+(?:\$|usd|uzs|eur|rub|sum|so['‘’ʼ`]?m|\d+(?:[.,]\d+)?\s*(?:usd|uzs|so['‘’ʼ`]?m|rub|\$))/i,
  /\b(?:pul(?:ni)?\s+(?:o['‘’ʼ`]?tkaz(?:ib|ing(?:lar)?|chi)?|tashla(?:b|ng)?|yubor(?:ib|ing)?)\b|karta(?:ga|m)\s+pul\s+(?:o['‘’ʼ`]?tkaz(?:ib|ing)?|tashla(?:b|ng)?)\b|to['‘’ʼ`]?lovni\s+(?:tasdiqla|amalga oshir|o['‘’ʼ`]?tkaz(?:ib|ing)?)\b)/i,
  /\b\d[\d\s,.]*\s*(?:so['‘’ʼ`]?m|sum|usd|eur|rub|\$)\s*(?:ni\s+)?(?:menga\s+)?(?:o['‘’ʼ`]?tkaz(?:ib|ing)?|tashla(?:b|ng)?|yubor(?:ib|ing)?|to['‘’ʼ`]?la(?:b|ng)?)\b/i,
  /\b(?:переведи(?:те)?\s+(?:деньги|средства|\d)|оплати(?:те)?\s+счёт|отправь(?:те)?\s+на\s+карту)\b/i,
  // Credential / OTP / password sharing demands
  /\b(?:tasdiqlash kod|sms kod|parol|login kod)(?:ing(?:iz)?)?(?:ni)?\b.{0,24}\b(?:ayt|yubor|ber)(?:ing(?:lar)?|gin|chi)?\b/i,
  /\b(?:give me|send me|tell me|share)\s+(?:your|the owner['’]?s)?\s*(?:password|otp|login code|pin|verification code|cvv|card number)\b/i,
  /\b(?:скажи|отправь|дай)\s+(?:пароль|код подтверждения|смс[- ]?код|cvv|пин)\b/i,
  // Binding legal / irreversible administrative actions on behalf of owner
  /\b(?:shartnoma(?:ni)?\s+imzola|rasmiy\s+kafil\s+bo['‘’ʼ`]?l|barcha\s+(?:xotira|xabar|ma['’]?lumot)ni\s+o['‘’ʼ`]?chir)/i,
  /\b(?:sign\s+(?:this|the)\s+contract|legally\s+bind|delete\s+all\s+(?:user\s+)?data|wipe\s+database)\b/i,
  /\b(?:подпиши(?:те)?\s+договор|удали(?:те)?\s+все\s+данные)\b/i,
];

// Informational / educational / ordinary support patterns that must NOT be falsely flagged
const INFORMATIONAL_CONTEXT_RE =
  /\b(?:nima(?:\s+u|\s+degani)?|qanday\s+(?:ishlaydi|yaratish|saqlash|himoya|hisoblash|o['‘]rnatish)|tushuntir(?:ib)?\s+ber|farqi\s+nima|haqida\s+ma['’]lumot|maslahat|misol|kodlash|dasturlash|what\s+is|how\s+does|how\s+to\s+create|explain|advice|что\s+такое|как\s+работает|объясни|совет)\b/i;

const SUSPICIOUS_URL_PATTERNS: RegExp[] = [
  /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?:[:/]|$)/i,
  /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|rb\.gy|clck\.ru|cutt\.ly|shorturl\.at)\//i,
  /\b(?:claim prize|urgent account verify|hisobingiz bloklandi|аккаунт заблокирован).{0,80}https?:\/\//i,
];

export function sanitizeMemoryTextForPrompt(raw: string): string {
  if (!raw) return '';
  let clean = sanitizeForLog(raw).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  for (const re of PROMPT_INJECTION_PATTERNS) {
    clean = clean.replace(re, '[filtered-directive]');
  }
  return clean.slice(0, 1200);
}

export function inspectInboundSecurity(
  text: string,
  customKeywordsCsv: string = ''
): SecurityInspectionResult {
  const normalized = (text || '').trim();
  const reasons: string[] = [];

  const promptInjectionDetected = PROMPT_INJECTION_PATTERNS.some((re) => re.test(normalized));
  if (promptInjectionDetected) reasons.push('prompt_injection_attempt');

  const secretCheck = containsSensitiveSecret(normalized);
  if (secretCheck.hasSecret) reasons.push(...secretCheck.reasons);

  const actionableHit = ACTIONABLE_HIGH_RISK_PATTERNS.some((re) => re.test(normalized));
  if (actionableHit) reasons.push('actionable_financial_credential_or_legal_request');

  const suspiciousScamOrLink = SUSPICIOUS_URL_PATTERNS.some((re) => re.test(normalized));
  if (suspiciousScamOrLink) reasons.push('suspicious_url_or_phishing_pattern');

  // Owner custom restricted keywords: evaluate contextually instead of naive substring blocking!
  const keywords = customKeywordsCsv
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);
  const lower = normalized.toLowerCase();
  const isInformational = INFORMATIONAL_CONTEXT_RE.test(normalized) && !actionableHit && !secretCheck.hasSecret;

  const matchedKeywords = isInformational
    ? []
    : keywords.filter((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordHit = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(lower);
        if (!wordHit) return false;
        // Require either actionable verb context or non-question imperative/commitment signal for generic words like "pul", "kod", "karta", "parol"
        if (['pul', 'karta', 'parol', 'kod', 'shartnoma', "to'lov"].includes(kw)) {
          return actionableHit || secretCheck.hasSecret;
        }
        return true;
      });

  if (matchedKeywords.length > 0) {
    reasons.push(`restricted_action_keyword:${matchedKeywords.join(',')}`);
  }

  const highRiskFinancialOrLegal =
    actionableHit || matchedKeywords.length > 0 || secretCheck.hasSecret;

  const riskLevel: SecurityInspectionResult['riskLevel'] =
    promptInjectionDetected || highRiskFinancialOrLegal || suspiciousScamOrLink
      ? 'high'
      : 'low';

  return {
    promptInjectionDetected,
    highRiskFinancialOrLegal,
    containsSecretOrOtp: secretCheck.hasSecret,
    suspiciousScamOrLink,
    matchedKeywords,
    reasons,
    riskLevel,
  };
}
