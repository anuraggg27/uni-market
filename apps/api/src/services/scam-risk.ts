import { keyedHash, sha256, safeEqual } from '../lib/crypto.js';

const RISK_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'OTP_OR_PASSWORD', pattern: /\b(otp|one[ -]?time password|password|verification code)\b/i },
  { code: 'RECOVERY_SECRET', pattern: /\b(recovery phrase|seed phrase|backup code|security answer)\b/i },
  { code: 'ADVANCE_PAYMENT', pattern: /\b(pay|payment|deposit|advance|booking amount)\b.{0,40}\b(before|first|confirm|reserve|hold)\b/i },
  { code: 'UPI_OR_QR', pattern: /\b(upi|qr code|collect request|scan.{0,20}(qr|code))\b/i },
  { code: 'REMOTE_ACCESS', pattern: /\b(anydesk|teamviewer|remote access|screen share|install.{0,20}(app|apk))\b/i },
  { code: 'SUSPICIOUS_LINK', pattern: /\b(bit\.ly|tinyurl\.com|t\.me|wa\.me|shorturl\.at)\b/i },
];

export function scamRiskCodes(body: string): string[] {
  return RISK_PATTERNS.filter(({ pattern }) => pattern.test(body)).map(({ code }) => code);
}

export function createScamConfirmation(userId: string, clientId: string, body: string, riskCodes: string[], secret: string): string {
  const expires = Date.now() + 5 * 60_000;
  const value = `${userId}:${clientId}:${sha256(body)}:${riskCodes.join(',')}:${expires}`;
  return `${expires}.${keyedHash(value, secret)}`;
}

export function verifyScamConfirmation(token: string | undefined, userId: string, clientId: string, body: string, riskCodes: string[], secret: string): boolean {
  if (!token) return false;
  const [expiresRaw, signature] = token.split('.');
  const expires = Number(expiresRaw);
  if (!signature || !Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = keyedHash(`${userId}:${clientId}:${sha256(body)}:${riskCodes.join(',')}:${expires}`, secret);
  return safeEqual(signature, expected);
}
