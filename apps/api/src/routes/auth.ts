import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { avatarIdSchema, defaultAvatarId } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { academicDomains, oauthAccounts, sessions, studentEmailVerifications, userRoles, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptText, maskEmail, randomToken, sha256 } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import type { GoogleVerifier } from '../services/google.js';
import { assertAvatarUnlocked, getAvatarAchievements } from '../services/avatar-achievements.js';

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarId: avatarIdSchema,
  academicDomainId: z.string().uuid(),
  campus: z.string().trim().max(120).nullable().optional(),
  graduationYear: z.number().int().min(2020).max(2040).nullable().optional()
}).strict();

function sessionCookie(config: AppConfig) {
  return { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 30 * 24 * 60 * 60_000 };
}

export function authRouter(db: Database, config: AppConfig, verifier: GoogleVerifier): Router {
  const router = Router();

  const currentUser = async (userId: string) => {
    const user = (await db.select({ id: users.id, email: users.email, displayName: users.displayName, avatarId: users.avatarId, institution: users.institution, campus: users.campus, graduationYear: users.graduationYear, phoneVerifiedAt: users.phoneVerifiedAt, phoneE164: users.phoneE164, studentEmailCiphertext: users.studentEmailCiphertext, studentEmailDomain: users.studentEmailDomain, studentEmailVerifiedAt: users.studentEmailVerifiedAt, studentEmailExpiresAt: users.studentEmailExpiresAt, adultAttestedAt: users.adultAttestedAt, onboardingComplete: users.onboardingComplete, suspendedAt: users.suspendedAt, createdAt: users.createdAt }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt), isNull(users.closedAt))).limit(1))[0];
    if (!user) return null;
    const avatarAchievements = await getAvatarAchievements(db, userId);
    const { studentEmailCiphertext, ...safeUser } = user;
    return {
      ...safeUser,
      avatarAchievements,
      phoneE164: user.phoneE164 ? `${user.phoneE164.slice(0, 3)}******${user.phoneE164.slice(-3)}` : null,
      studentEmailMasked: studentEmailCiphertext ? maskEmail(decryptText(studentEmailCiphertext, config.DATA_ENCRYPTION_KEY)) : null,
    };
  };

  router.post('/google', asyncRoute(async (req, res) => {
    const { credential, reactivate } = z.object({
      credential: z.string().min(20).max(10_000),
      reactivate: z.boolean().default(false),
    }).parse(req.body);
    const identity = await verifier.verify(credential);
    if (!identity.emailVerified) throw new AppError(401, 'EMAIL_NOT_VERIFIED', 'Use a verified Google account');
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const existingAccount = (await tx.select({ userId: oauthAccounts.userId }).from(oauthAccounts).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerSubject, identity.sub))).limit(1))[0];
      if (existingAccount) {
        const current = (await tx.select().from(users).where(eq(users.id, existingAccount.userId)).limit(1))[0];
        if (!current) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'This account is no longer available');
        if (current.closedAt && !reactivate) {
          throw new AppError(409, 'ACCOUNT_PENDING_DELETION', 'This account is closed and queued for deletion', {
            purgeAfter: current.purgeAfter?.toISOString() ?? null,
          });
        }
        if (current.deletedAt && !current.closedAt) throw new AppError(410, 'ACCOUNT_DELETED', 'This account has already been deleted');
        const existing = (await tx.update(users).set({
          email: identity.email.toLowerCase(),
          avatarId: current.avatarId ?? defaultAvatarId,
          lastActiveAt: now,
          ...(current.closedAt && reactivate ? { closedAt: null, deletedAt: null, purgeAfter: null } : {}),
          updatedAt: now,
        }).where(eq(users.id, existingAccount.userId)).returning())[0]!;
        await tx.update(oauthAccounts).set({ emailAtLogin: identity.email.toLowerCase() }).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerSubject, identity.sub)));
        return { user: existing, reactivated: Boolean(current.closedAt && reactivate) };
      }
      const created = (await tx.insert(users).values({ email: identity.email.toLowerCase(), displayName: identity.name, avatarId: defaultAvatarId }).returning())[0]!;
      await tx.insert(oauthAccounts).values({ userId: created.id, providerSubject: identity.sub, emailAtLogin: identity.email.toLowerCase() });
      await tx.insert(userRoles).values({ userId: created.id, role: 'USER' });
      return { user: created, reactivated: false };
    });
    const { user } = result;
    const bootstrap = new Set(config.BOOTSTRAP_ADMIN_EMAILS.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    if (bootstrap.has(user.email.toLowerCase())) await db.insert(userRoles).values({ userId: user.id, role: 'SUPER_ADMIN' }).onConflictDoNothing();
    if (req.cookies?.campus_session) await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, sha256(`${req.cookies.campus_session}:${config.SESSION_SECRET}`)));
    const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, user.id));
    const isStaff = roles.some(({ role }) => role !== 'USER');
    const raw = randomToken();
    await db.insert(sessions).values({ userId: user.id, tokenHash: sha256(`${raw}:${config.SESSION_SECRET}`), expiresAt: new Date(now.getTime() + (isStaff ? 8 : 30 * 24) * 60 * 60_000), staffVerifiedAt: isStaff ? now : null, userAgent: req.header('user-agent')?.slice(0, 500), ipHash: sha256(req.ip) });
    res.cookie('campus_session', raw, sessionCookie(config));
    res.status(200).json({ data: { onboardingRequired: !user.onboardingComplete, reactivated: result.reactivated } });
  }));

  router.post('/google/step-up', requireAuth, asyncRoute(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20).max(10_000) }).parse(req.body);
    const identity = await verifier.verify(credential);
    const account = (await db.select({ userId: oauthAccounts.userId }).from(oauthAccounts).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerSubject, identity.sub), eq(oauthAccounts.userId, req.auth!.userId))).limit(1))[0];
    if (!account || !identity.emailVerified) throw new AppError(401, 'STEP_UP_FAILED', 'The Google account did not match this session');
    await db.update(sessions).set({ staffVerifiedAt: new Date() }).where(eq(sessions.id, req.auth!.sessionId));
    res.json({ data: { verified: true } });
  }));

  router.get('/csrf', requireAuth, asyncRoute(async (req, res) => {
    const token = randomToken();
    await db.update(sessions).set({ csrfHash: sha256(`${token}:${config.CSRF_SECRET}`) }).where(eq(sessions.id, req.auth!.sessionId));
    res.setHeader('cache-control', 'no-store');
    res.json({ data: { csrfToken: token } });
  }));

  router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.auth!.sessionId));
    res.clearCookie('campus_session', sessionCookie(config));
    res.status(204).end();
  }));

  router.get('/session', asyncRoute(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (!req.auth) {
      res.json({ data: null });
      return;
    }
    const user = await currentUser(req.auth.userId);
    res.json({ data: user ? { ...user, roles: req.auth.roles, marketplaceEligible: req.auth.marketplaceEligible, eligibility: { phoneVerified: req.auth.phoneVerified, studentEmailVerified: req.auth.studentEmailVerified, adultAttested: req.auth.adultAttested, policiesAccepted: req.auth.policiesAccepted } } : null });
  }));

  router.get('/me', requireAuth, asyncRoute(async (req, res) => {
    const user = await currentUser(req.auth!.userId);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
    res.setHeader('cache-control', 'no-store');
    res.json({ data: { ...user, roles: req.auth!.roles, marketplaceEligible: req.auth!.marketplaceEligible, eligibility: { phoneVerified: req.auth!.phoneVerified, studentEmailVerified: req.auth!.studentEmailVerified, adultAttested: req.auth!.adultAttested, policiesAccepted: req.auth!.policiesAccepted } } });
  }));

  router.patch('/me', requireAuth, asyncRoute(async (req, res) => {
    const input = profileSchema.parse(req.body);
    await assertAvatarUnlocked(db, req.auth!.userId, input.avatarId);
    const academicDomain = (await db.select().from(academicDomains).where(and(eq(academicDomains.id, input.academicDomainId), eq(academicDomains.active, true))).limit(1))[0];
    if (!academicDomain) throw new AppError(400, 'ACADEMIC_DOMAIN_NOT_APPROVED', 'Choose a supported college or institution');
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const current = (await tx.select({ studentEmailDomain: users.studentEmailDomain }).from(users).where(eq(users.id, req.auth!.userId)).limit(1))[0];
      const domainChanged = Boolean(current?.studentEmailDomain && current.studentEmailDomain !== academicDomain.domain);
      const result = (await tx.update(users).set({
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
        ...(input.campus !== undefined ? { campus: input.campus } : {}),
        ...(input.graduationYear !== undefined ? { graduationYear: input.graduationYear } : {}),
        updatedAt: now,
      }).where(eq(users.id, req.auth!.userId)).returning({ id: users.id, displayName: users.displayName, onboardingComplete: users.onboardingComplete }))[0]!;
      if (domainChanged) {
        await tx.update(studentEmailVerifications).set({ invalidatedAt: now }).where(and(eq(studentEmailVerifications.userId, req.auth!.userId), isNull(studentEmailVerifications.usedAt), isNull(studentEmailVerifications.invalidatedAt)));
      }
      return result;
    });
    res.json({ data: updated });
  }));

  router.patch('/me/avatar', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ avatarId: avatarIdSchema }).strict().parse(req.body);
    await assertAvatarUnlocked(db, req.auth!.userId, input.avatarId);
    const updated = (await db.update(users).set({ avatarId: input.avatarId, updatedAt: new Date() }).where(eq(users.id, req.auth!.userId)).returning({ avatarId: users.avatarId }))[0];
    if (!updated) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
    res.json({ data: updated });
  }));

  return router;
}
