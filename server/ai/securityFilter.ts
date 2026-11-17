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
    regex: /\b(?:parol(?:im)?|password|passcode|otp|cvv|cvc|pin[- ]?kod|tasdiqlash kodi|секретный код|пароль|код входа)\s*(?:is|=|:|-|\bu\b)?\s*[A-Za-z0-9!@#$%^&*_-]{4,}/i,
  },
  {
    label: 'seed_phrase_hint',
    regex: /\b(?:seed phrase|recovery phrase|12 words|24 words|mnemonic)\b/i,
  },
];

export function containsSensitiveSecret(text: string): { hasSecret: boolean; reasons: string[] } {
  const clean = text.trim();
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

const HIGH_RISK_COMMITMENT_PATTERNS: RegExp[] = [
  /\b(?:send|transfer|wire|pay)\s+(?:\$|usd|uzs|sum|so['‘]?m|\d)/i,
  /\b(?:pul o['‘]tkaz|o['‘]tkazib ber|karta raqam|shartnoma imzola|kafil bo['‘]l|qarz ber)\b/i,
  /\b(?:переведи деньги|номер карты|подпиши договор|выдай кредит)\b/i,
  /\b(?:tasdiqlash kodini ayt|sms kodni yubor|parolni ber|login kod)\b/i,
  /\b(?:give me (?:your )?(?:password|otp|login code|pin|verification code))\b/i,
];

const SUSPICIOUS_URL_PATTERNS: RegExp[] = [
  /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?:[:/]|$)/i,
  /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|rb\.gy|clck\.ru|cutt\.ly|shorturl\.at)\//i,
  /\b(?:claim prize|urgent account verify|hisobingiz bloklandi|аккаунт заблокирован).{0,80}https?:\/\//i,
];

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

  const highRiskPatternHit = HIGH_RISK_COMMITMENT_PATTERNS.some((re) => re.test(normalized));
  if (highRiskPatternHit) reasons.push('high_risk_financial_or_credential_request');

  const suspiciousScamOrLink = SUSPICIOUS_URL_PATTERNS.some((re) => re.test(normalized));
  if (suspiciousScamOrLink) reasons.push('suspicious_url_or_phishing_pattern');

  const keywords = customKeywordsCsv
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);
  const lower = normalized.toLowerCase();
  const matchedKeywords = keywords.filter((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(lower);
  });
  if (matchedKeywords.length > 0) {
    reasons.push(`keyword:${matchedKeywords.join(',')}`);
  }

  const highRiskFinancialOrLegal =
    highRiskPatternHit || matchedKeywords.length > 0 || secretCheck.hasSecret;

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
