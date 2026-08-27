import { domainToASCII } from 'node:url';
import { Router } from 'express';
import { and, asc, count, desc, eq, gt, gte, isNull, ne } from 'drizzle-orm';
import { avatarIdSchema, currentPolicyVersion, requiredOnboardingPolicies } from '@campus-market/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { academicDomains, policyAcceptances, studentEmailVerifications, users } from '../db/schema.js';
import { decryptText, encryptText, keyedHash, maskEmail, sha256, safeEqual } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { verifiedMsg91Identifier } from '../services/msg91.js';

const emailInput = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const onboardingInput = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarId: avatarIdSchema,
  academicDomainId: z.string().uuid(),
  campus: z.string().trim().max(120).nullable().optional(),
  graduationYear: z.number().int().min(2020).max(2040).nullable().optional(),
  adultAttested: z.literal(true),
  acceptTerms: z.literal(true),
  acknowledgePrivacy: z.literal(true),
  acceptCommunityRules: z.literal(true),
  policyVersion: z.literal(currentPolicyVersion),
}).strict();

function splitStudentEmail(value: string): { email: string; domain: string } {
  const email = emailInput.parse(value);
  const rawDomain = email.slice(email.lastIndexOf('@') + 1);
  const domain = domainToASCII(rawDomain).toLowerCase();
  if (!domain) throw new AppError(400, 'INVALID_STUDENT_EMAIL', 'Enter a valid student email address');
  return { email: `${email.slice(0, email.lastIndexOf('@'))}@${domain}`, domain };
}

async function approvedAcademicDomain(db: Database, domain: string): Promise<typeof academicDomains.$inferSelect> {
  const domains = await db.select().from(academicDomains).where(eq(academicDomains.active, true));
  const academicDomain = domains.find((entry) => domain === entry.domain || (entry.allowSubdomains && domain.endsWith(`.${entry.domain}`)));
  if (!academicDomain) throw new AppError(400, 'ACADEMIC_DOMAIN_NOT_APPROVED', 'This institution email domain has not been approved yet');
  return academicDomain;
}

async function assertSelectedAcademicDomain(db: Database, userId: string, domain: string): Promise<void> {
  const user = (await db.select({ institution: users.institution, studentEmailDomain: users.studentEmailDomain }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (user?.studentEmailDomain) {
    if (domain !== user.studentEmailDomain) {
      throw new AppError(400, 'STUDENT_EMAIL_DOMAIN_MISMATCH', 'Use the student email domain for your selected institution');
    }
    return;
  }
  if (user?.institution) {
    const legacyMatch = (await db.select({ id: academicDomains.id }).from(academicDomains).where(and(eq(academicDomains.domain, domain), eq(academicDomains.institutionName, user.institution), eq(academicDomains.active, true))).limit(1))[0];
    if (legacyMatch) return;
  }
  throw new AppError(400, 'INSTITUTION_REQUIRED', 'Choose your college or institution before verifying a student email');
}

async function assertStudentEmailAvailable(db: Database, userId: string, emailHash: string): Promise<void> {
  const conflict = (await db.select({ id: users.id }).from(users).where(and(eq(users.studentEmailHash, emailHash), gt(users.studentEmailVerifiedAt, new Date(0)), ne(users.id, userId))).limit(1))[0];
  if (conflict) throw new AppError(409, 'STUDENT_EMAIL_IN_USE', 'This student email is already verified on another account');
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

export function publicCompliance(config: AppConfig) {
  return {
    customerCareEmail: config.CUSTOMER_CARE_EMAIL,
    privacyEmail: config.PRIVACY_EMAIL,
    grievanceRetentionDays: config.GRIEVANCE_RETENTION_DAYS,
    transactionModel: 'Uni Market only facilitates introductions between users. Payments, inspection, delivery, returns and any exchange happen directly between users offline. Uni Market does not provide payment processing, escrow, shipping, refunds, warranties or guarantees.',
    ranking: 'The default order is newest approved first. Price sorts use the listing price. Popular order uses views plus three times favourites. There is no paid placement, personalisation or university preference.',
  };
}

export function eligibilityRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.get('/compliance', (_req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json({ data: publicCompliance(config) });
  });

  router.get('/academic-domains', requireAuth, asyncRoute(async (_req, res) => {
    const domains = await db.select({
      id: academicDomains.id,
      domain: academicDomains.domain,
      institutionName: academicDomains.institutionName,
    }).from(academicDomains).where(eq(academicDomains.active, true)).orderBy(asc(academicDomains.institutionName));
    res.setHeader('cache-control', 'private, max-age=300');
    res.json({ data: domains });
  }));

  router.post('/onboarding/complete', requireAuth, asyncRoute(async (req, res) => {
    const input = onboardingInput.parse(req.body);
    const academicDomain = (await db.select().from(academicDomains).where(and(eq(academicDomains.id, input.academicDomainId), eq(academicDomains.active, true))).limit(1))[0];
    if (!academicDomain) throw new AppError(400, 'ACADEMIC_DOMAIN_NOT_APPROVED', 'Choose a supported college or institution');
    const now = new Date();
    await db.transaction(async (tx) => {
      const current = (await tx.select({ studentEmailDomain: users.studentEmailDomain }).from(users).where(eq(users.id, req.auth!.userId)).limit(1))[0];
      const domainChanged = Boolean(current?.studentEmailDomain && current.studentEmailDomain !== academicDomain.domain);
      await tx.update(users).set({
        displayName: input.displayName,
        avatarId: input.avatarId,
        institution: academicDomain.institutionName,
        studentEmailDomain: academicDomain.domain,
        ...(domainChanged ? {
          studentEmailCiphertext: null,
          studentEmailHash: null,
          studentEmailVerifiedAt: null,
          studentEmailExpiresAt: null,
        } : {}),
        campus: input.campus ?? null,
        graduationYear: input.graduationYear ?? null,
        adultAttestedAt: now,
        onboardingComplete: true,
        updatedAt: now,
      }).where(eq(users.id, req.auth!.userId));
      if (domainChanged) {
        await tx.update(studentEmailVerifications).set({ invalidatedAt: now }).where(and(eq(studentEmailVerifications.userId, req.auth!.userId), isNull(studentEmailVerifications.usedAt), isNull(studentEmailVerifications.invalidatedAt)));
      }
      await tx.insert(policyAcceptances).values(requiredOnboardingPolicies.map((policy) => ({
        userId: req.auth!.userId,
        policy,
        version: currentPolicyVersion,
        source: 'ONBOARDING',
      }))).onConflictDoNothing();
    });
    res.json({ data: { completed: true } });
  }));

  router.get('/student-email/config', requireAuth, (_req, res) => {
    if (config.DEV_MODE) {
      res.json({ data: { provider: 'development', otpLength: 6, retryAfter: config.OTP_RESEND_COOLDOWN_SECONDS, verificationMonths: 12 } });
      return;
    }
    res.json({ data: {
      provider: 'msg91',
      widgetId: config.MSG91_WIDGET_ID,
      tokenAuth: config.MSG91_TOKEN_AUTH,
      otpLength: config.MSG91_OTP_LENGTH,
      retryAfter: config.OTP_RESEND_COOLDOWN_SECONDS,
      verificationMonths: 12,
    } });
  });

  router.post('/student-email/check-availability', requireAuth, asyncRoute(async (req, res) => {
    const { email, domain } = splitStudentEmail(z.object({ email: z.string() }).parse(req.body).email);
    await approvedAcademicDomain(db, domain);
    await assertSelectedAcademicDomain(db, req.auth!.userId, domain);
    await assertStudentEmailAvailable(db, req.auth!.userId, keyedHash(email, config.DATA_ENCRYPTION_KEY));
    res.json({ data: { available: true, maskedEmail: maskEmail(email) } });
  }));

  router.post('/student-email/send', requireAuth, asyncRoute(async (req, res) => {
    const { email, domain } = splitStudentEmail(z.object({ email: z.string() }).parse(req.body).email);
    const academicDomain = await approvedAcademicDomain(db, domain);
    await assertSelectedAcademicDomain(db, req.auth!.userId, domain);
    const emailHash = keyedHash(email, config.DATA_ENCRYPTION_KEY);
    await assertStudentEmailAvailable(db, req.auth!.userId, emailHash);
    if (!config.DEV_MODE) throw new AppError(400, 'OTP_WIDGET_REQUIRED', 'Use MSG91 verification to request a student email code');
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const latest = (await db.select().from(studentEmailVerifications).where(and(eq(studentEmailVerifications.userId, req.auth!.userId), eq(studentEmailVerifications.emailHash, emailHash))).orderBy(desc(studentEmailVerifications.createdAt)).limit(1))[0];
    if (latest && Math.floor((now.getTime() - latest.sentAt.getTime()) / 1000) < config.OTP_RESEND_COOLDOWN_SECONDS) throw new AppError(429, 'OTP_COOLDOWN', 'Wait before requesting another code');
    const recent = await db.select({ value: count() }).from(studentEmailVerifications).where(and(eq(studentEmailVerifications.emailHash, emailHash), gte(studentEmailVerifications.sentAt, hourAgo)));
    if ((recent[0]?.value ?? 0) >= 5) throw new AppError(429, 'OTP_RATE_LIMITED', 'Too many verification requests. Try again later.');
    await db.update(studentEmailVerifications).set({ invalidatedAt: now }).where(and(eq(studentEmailVerifications.userId, req.auth!.userId), isNull(studentEmailVerifications.usedAt), isNull(studentEmailVerifications.invalidatedAt)));
    const code = '999999';
    await db.insert(studentEmailVerifications).values({
      userId: req.auth!.userId,
      academicDomainId: academicDomain.id,
      emailCiphertext: encryptText(email, config.DATA_ENCRYPTION_KEY),
      emailHash,
      otpHash: keyedHash(`${req.auth!.userId}:${emailHash}:${code}`, config.SESSION_SECRET),
      ipHash: sha256(req.ip),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });
    res.json({ data: { message: 'If the address can receive email, a code has been sent', maskedEmail: maskEmail(email), retryAfter: config.OTP_RESEND_COOLDOWN_SECONDS } });
  }));

  router.post('/student-email/verify', requireAuth, asyncRoute(async (req, res) => {
    if (!config.DEV_MODE) throw new AppError(400, 'OTP_WIDGET_REQUIRED', 'Use MSG91 verification to verify the student email code');
    const input = z.object({ email: z.string(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const { email, domain } = splitStudentEmail(input.email);
    await assertSelectedAcademicDomain(db, req.auth!.userId, domain);
    const emailHash = keyedHash(email, config.DATA_ENCRYPTION_KEY);
    const now = new Date();
    const verification = (await db.select().from(studentEmailVerifications).where(and(eq(studentEmailVerifications.userId, req.auth!.userId), eq(studentEmailVerifications.emailHash, emailHash), isNull(studentEmailVerifications.usedAt), isNull(studentEmailVerifications.invalidatedAt))).orderBy(desc(studentEmailVerifications.createdAt)).limit(1))[0];
    if (!verification || verification.expiresAt <= now || verification.attempts >= config.OTP_MAX_ATTEMPTS) throw new AppError(400, 'OTP_INVALID', 'The verification code could not be accepted');
    const expected = keyedHash(`${req.auth!.userId}:${emailHash}:${input.code}`, config.SESSION_SECRET);
    if (!safeEqual(verification.otpHash, expected)) {
      const attempts = verification.attempts + 1;
      await db.update(studentEmailVerifications).set({ attempts, ...(attempts >= config.OTP_MAX_ATTEMPTS ? { invalidatedAt: now } : {}) }).where(eq(studentEmailVerifications.id, verification.id));
      throw new AppError(400, 'OTP_INVALID', 'The verification code could not be accepted');
    }
    const academicDomain = (await db.select().from(academicDomains).where(and(eq(academicDomains.id, verification.academicDomainId), eq(academicDomains.active, true))).limit(1))[0];
    if (!academicDomain || !(domain === academicDomain.domain || (academicDomain.allowSubdomains && domain.endsWith(`.${academicDomain.domain}`)))) throw new AppError(400, 'ACADEMIC_DOMAIN_NOT_APPROVED', 'This institution email domain is no longer approved');
    await assertStudentEmailAvailable(db, req.auth!.userId, emailHash);
    await db.transaction(async (tx) => {
      await tx.update(users).set({
        studentEmailCiphertext: encryptText(email, config.DATA_ENCRYPTION_KEY),
        studentEmailHash: emailHash,
        studentEmailDomain: academicDomain.domain,
        studentEmailVerifiedAt: now,
        studentEmailExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60_000),
        institution: academicDomain.institutionName,
        updatedAt: now,
      }).where(eq(users.id, req.auth!.userId));
      await tx.update(studentEmailVerifications).set({ usedAt: now, invalidatedAt: now }).where(eq(studentEmailVerifications.id, verification.id));
    });
    res.json({ data: { verified: true, maskedEmail: maskEmail(decryptText(verification.emailCiphertext, config.DATA_ENCRYPTION_KEY)), expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60_000).toISOString() } });
  }));

  router.post('/student-email/verify-provider', requireAuth, asyncRoute(async (req, res) => {
    if (config.DEV_MODE) throw new AppError(400, 'OTP_DEVELOPMENT_MODE', 'Provider verification is disabled in development mode');
    const input = z.object({
      email: z.string(),
      accessToken: z.string().min(20).max(8_192),
    }).parse(req.body);
    const { email, domain } = splitStudentEmail(input.email);
    const academicDomain = await approvedAcademicDomain(db, domain);
    await assertSelectedAcademicDomain(db, req.auth!.userId, domain);
    const emailHash = keyedHash(email, config.DATA_ENCRYPTION_KEY);
    await assertStudentEmailAvailable(db, req.auth!.userId, emailHash);

    const tokenHash = keyedHash(`msg91:${input.accessToken}`, config.SESSION_SECRET);
    const alreadyUsed = (await db.select({ id: studentEmailVerifications.id }).from(studentEmailVerifications).where(eq(studentEmailVerifications.otpHash, tokenHash)).limit(1))[0];
    if (alreadyUsed) throw new AppError(400, 'OTP_INVALID', 'The student email verification could not be accepted');

    const providerIdentifier = await verifiedMsg91Identifier(config, input.accessToken, {
      unavailable: 'Student email verification is temporarily unavailable',
      invalid: 'The student email verification could not be accepted',
    });
    if (providerIdentifier.toLowerCase() !== email) {
      throw new AppError(400, 'OTP_INVALID', 'The student email verification could not be accepted');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60_000);
    try {
      await db.transaction(async (tx) => {
        await tx.update(users).set({
          studentEmailCiphertext: encryptText(email, config.DATA_ENCRYPTION_KEY),
          studentEmailHash: emailHash,
          studentEmailDomain: academicDomain.domain,
          studentEmailVerifiedAt: now,
          studentEmailExpiresAt: expiresAt,
          institution: academicDomain.institutionName,
          updatedAt: now,
        }).where(eq(users.id, req.auth!.userId));
        await tx.insert(studentEmailVerifications).values({
          userId: req.auth!.userId,
          academicDomainId: academicDomain.id,
          emailCiphertext: encryptText(email, config.DATA_ENCRYPTION_KEY),
          emailHash,
          otpHash: tokenHash,
          ipHash: sha256(req.ip),
          expiresAt: now,
          usedAt: now,
          invalidatedAt: now,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) await assertStudentEmailAvailable(db, req.auth!.userId, emailHash);
      throw error;
    }
    res.json({ data: { verified: true, maskedEmail: maskEmail(email), expiresAt: expiresAt.toISOString() } });
  }));

  return router;
}
