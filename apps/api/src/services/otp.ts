import { and, count, desc, eq, gt, gte, isNull, ne } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { phoneVerifications, users } from '../db/schema.js';
import { keyedHash, maskPhone, safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const GENERIC_FAILURE = 'The verification code could not be accepted';
const GENERIC_PROVIDER_FAILURE = 'The phone verification could not be accepted';

type Msg91VerificationResponse = {
  type?: unknown;
  message?: unknown;
};

export class OtpService {
  constructor(private db: Database, private config: AppConfig) {}

  async assertPhoneAvailable(userId: string, phoneE164: string): Promise<void> {
    const conflict = (await this.db.select({ id: users.id }).from(users).where(and(eq(users.phoneE164, phoneE164), gt(users.phoneVerifiedAt, new Date(0)), ne(users.id, userId))).limit(1))[0];
    if (conflict) {
      throw new AppError(409, 'PHONE_ALREADY_IN_USE', 'This phone number is already being used by another account');
    }
  }

  async send(userId: string, phoneE164: string, ipHash: string): Promise<{ retryAfter: number }> {
    if (!this.config.DEV_MODE) {
      throw new AppError(400, 'OTP_WIDGET_REQUIRED', 'Use the phone verification widget to request a code');
    }
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
    const otp = '999999';
    logger.warn({ phone: maskPhone(phoneE164) }, 'development OTP mode active; external SMS disabled');
    await this.db.insert(phoneVerifications).values({
      userId, phoneE164, otpHash: keyedHash(`${userId}:${phoneE164}:${otp}`, this.config.SESSION_SECRET), providerSessionId: null,
      ipHash, expiresAt: new Date(now.getTime() + this.config.OTP_EXPIRY_MINUTES * 60_000)
    });
    return { retryAfter: this.config.OTP_RESEND_COOLDOWN_SECONDS };
  }

  async verify(userId: string, phoneE164: string, otp: string): Promise<void> {
    if (!this.config.DEV_MODE) {
      throw new AppError(400, 'OTP_WIDGET_REQUIRED', 'Use the phone verification widget to verify the code');
    }
    const now = new Date();
    const verification = (await this.db.select().from(phoneVerifications).where(and(eq(phoneVerifications.userId, userId), eq(phoneVerifications.phoneE164, phoneE164), isNull(phoneVerifications.usedAt), isNull(phoneVerifications.invalidatedAt))).orderBy(desc(phoneVerifications.createdAt)).limit(1))[0];
    if (!verification || verification.expiresAt <= now || verification.attempts >= this.config.OTP_MAX_ATTEMPTS) throw new AppError(400, 'OTP_INVALID', GENERIC_FAILURE);
    const expected = keyedHash(`${userId}:${phoneE164}:${otp}`, this.config.SESSION_SECRET);
    if (!safeEqual(verification.otpHash, expected)) {
      const attempts = verification.attempts + 1;
      await this.db.update(phoneVerifications).set({ attempts, ...(attempts >= this.config.OTP_MAX_ATTEMPTS ? { invalidatedAt: now } : {}) }).where(eq(phoneVerifications.id, verification.id));
      throw new AppError(400, 'OTP_INVALID', GENERIC_FAILURE);
    }
    try {
      await this.assertPhoneAvailable(userId, phoneE164);
    } catch (error) {
      await this.db.update(phoneVerifications).set({ invalidatedAt: now }).where(eq(phoneVerifications.id, verification.id));
      throw error;
    }
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ phoneE164, phoneVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
      await tx.update(phoneVerifications).set({ usedAt: now, invalidatedAt: now }).where(eq(phoneVerifications.id, verification.id));
    });
  }

  async verifyProviderToken(userId: string, phoneE164: string, accessToken: string, ipHash: string): Promise<void> {
    if (this.config.DEV_MODE) {
      throw new AppError(400, 'OTP_DEVELOPMENT_MODE', 'Provider verification is disabled in development mode');
    }
    if (!this.config.MSG91_AUTH_KEY) {
      throw new AppError(503, 'OTP_UNAVAILABLE', 'Phone verification is temporarily unavailable');
    }

    const tokenHash = keyedHash(`msg91:${accessToken}`, this.config.SESSION_SECRET);
    const alreadyUsed = (await this.db.select({ id: phoneVerifications.id }).from(phoneVerifications).where(eq(phoneVerifications.otpHash, tokenHash)).limit(1))[0];
    if (alreadyUsed) throw new AppError(400, 'OTP_INVALID', GENERIC_PROVIDER_FAILURE);

    let response: Response;
    try {
      response = await fetch(this.config.MSG91_VERIFY_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          authkey: this.config.MSG91_AUTH_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ 'access-token': accessToken }),
        signal: AbortSignal.timeout(8_000)
      });
    } catch (error) {
      logger.warn({ err: error }, 'MSG91 access-token verification request failed');
      throw new AppError(503, 'OTP_UNAVAILABLE', 'Phone verification is temporarily unavailable');
    }

    let body: Msg91VerificationResponse = {};
    try {
      body = await response.json() as Msg91VerificationResponse;
    } catch {
      // A non-JSON provider response cannot prove ownership of the phone number.
    }
    if (response.status === 429 || response.status >= 500) {
      logger.warn({ status: response.status }, 'MSG91 access-token verification unavailable');
      throw new AppError(503, 'OTP_UNAVAILABLE', 'Phone verification is temporarily unavailable');
    }

    const identifier = typeof body.message === 'string' ? body.message.replace(/\D/g, '') : '';
    const expectedIdentifier = phoneE164.slice(1);
    if (!response.ok || body.type !== 'success' || identifier !== expectedIdentifier) {
      throw new AppError(400, 'OTP_INVALID', GENERIC_PROVIDER_FAILURE);
    }

    const now = new Date();
    await this.assertPhoneAvailable(userId, phoneE164);

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ phoneE164, phoneVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
      await tx.insert(phoneVerifications).values({
        userId,
        phoneE164,
        otpHash: tokenHash,
        providerSessionId: 'msg91',
        ipHash,
        expiresAt: now,
        usedAt: now,
        invalidatedAt: now
      });
    });
  }
}
