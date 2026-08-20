import { and, count, desc, eq, gt, gte, isNull, ne } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { phoneVerifications, users } from '../db/schema.js';
import { keyedHash, maskPhone, safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const GENERIC_FAILURE = 'The verification code could not be accepted';

export class OtpService {
  constructor(private db: Database, private config: AppConfig) {}

  async send(userId: string, phoneE164: string, ipHash: string): Promise<{ retryAfter: number }> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const last = (await this.db.select().from(phoneVerifications).where(and(eq(phoneVerifications.userId, userId), eq(phoneVerifications.phoneE164, phoneE164))).orderBy(desc(phoneVerifications.createdAt)).limit(1))[0];
    if (last) {
      const elapsed = Math.floor((now.getTime() - last.sentAt.getTime()) / 1000);
      if (elapsed < this.config.OTP_RESEND_COOLDOWN_SECONDS) throw new AppError(429, 'OTP_COOLDOWN', `Wait ${this.config.OTP_RESEND_COOLDOWN_SECONDS - elapsed} seconds before requesting another code`);
    }
    const [phoneHour, phoneDay, ipHour] = await Promise.all([
      this.db.select({ value: count() }).from(phoneVerifications).where(and(eq(phoneVerifications.phoneE164, phoneE164), gte(phoneVerifications.sentAt, hourAgo))),
      this.db.select({ value: count() }).from(phoneVerifications).where(and(eq(phoneVerifications.phoneE164, phoneE164), gte(phoneVerifications.sentAt, dayAgo))),
      this.db.select({ value: count() }).from(phoneVerifications).where(and(eq(phoneVerifications.ipHash, ipHash), gte(phoneVerifications.sentAt, hourAgo)))
    ]);
    if ((phoneHour[0]?.value ?? 0) >= 5 || (phoneDay[0]?.value ?? 0) >= 10 || (ipHour[0]?.value ?? 0) >= this.config.OTP_MAX_IP_HOUR) {
      throw new AppError(429, 'OTP_RATE_LIMITED', 'Too many verification requests. Try again later.');
    }
    await this.db.update(phoneVerifications).set({ invalidatedAt: now }).where(and(eq(phoneVerifications.userId, userId), isNull(phoneVerifications.usedAt), isNull(phoneVerifications.invalidatedAt)));
    const otp = this.config.DEV_MODE ? '999999' : String(Math.floor(100000 + Math.random() * 900000));
    let providerSessionId: string | null = null;
    if (this.config.DEV_MODE) {
      logger.warn({ phone: maskPhone(phoneE164) }, 'development OTP mode active; external SMS disabled');
    } else {
      if (!this.config.OTP_SERVICE_API_KEY) throw new AppError(503, 'OTP_UNAVAILABLE', 'Phone verification is temporarily unavailable');
      const phone = phoneE164.slice(1);
      const url = `${this.config.OTP_SERVICE_BASE_URL}/${encodeURIComponent(this.config.OTP_SERVICE_API_KEY)}/SMS/${phone}/${otp}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const body = await response.json() as { Status?: string; Details?: string };
      if (!response.ok || body.Status !== 'Success') throw new AppError(503, 'OTP_UNAVAILABLE', 'Phone verification is temporarily unavailable');
      providerSessionId = body.Details ?? null;
    }
    await this.db.insert(phoneVerifications).values({
      userId, phoneE164, otpHash: keyedHash(`${userId}:${phoneE164}:${otp}`, this.config.SESSION_SECRET), providerSessionId,
      ipHash, expiresAt: new Date(now.getTime() + this.config.OTP_EXPIRY_MINUTES * 60_000)
    });
    return { retryAfter: this.config.OTP_RESEND_COOLDOWN_SECONDS };
  }

  async verify(userId: string, phoneE164: string, otp: string): Promise<void> {
    const now = new Date();
    const verification = (await this.db.select().from(phoneVerifications).where(and(eq(phoneVerifications.userId, userId), eq(phoneVerifications.phoneE164, phoneE164), isNull(phoneVerifications.usedAt), isNull(phoneVerifications.invalidatedAt))).orderBy(desc(phoneVerifications.createdAt)).limit(1))[0];
    if (!verification || verification.expiresAt <= now || verification.attempts >= this.config.OTP_MAX_ATTEMPTS) throw new AppError(400, 'OTP_INVALID', GENERIC_FAILURE);
    const expected = keyedHash(`${userId}:${phoneE164}:${otp}`, this.config.SESSION_SECRET);
    if (!safeEqual(verification.otpHash, expected)) {
      const attempts = verification.attempts + 1;
      await this.db.update(phoneVerifications).set({ attempts, ...(attempts >= this.config.OTP_MAX_ATTEMPTS ? { invalidatedAt: now } : {}) }).where(eq(phoneVerifications.id, verification.id));
      throw new AppError(400, 'OTP_INVALID', GENERIC_FAILURE);
    }
    const conflict = (await this.db.select({ id: users.id }).from(users).where(and(eq(users.phoneE164, phoneE164), gt(users.phoneVerifiedAt, new Date(0)), ne(users.id, userId))).limit(1))[0];
    if (conflict) {
      await this.db.update(phoneVerifications).set({ invalidatedAt: now }).where(eq(phoneVerifications.id, verification.id));
      throw new AppError(400, 'OTP_INVALID', GENERIC_FAILURE);
    }
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ phoneE164, phoneVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
      await tx.update(phoneVerifications).set({ usedAt: now, invalidatedAt: now }).where(eq(phoneVerifications.id, verification.id));
    });
  }
}
