import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { oauthAccounts, sessions, userRoles, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import type { GoogleVerifier } from '../services/google.js';

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarUrl: z.string().url().nullable().optional(),
  institution: z.string().trim().max(120).nullable().optional(),
  campus: z.string().trim().max(120).nullable().optional(),
  graduationYear: z.number().int().min(2020).max(2040).nullable().optional(),
  onboardingComplete: z.boolean().optional()
}).strict();

function sessionCookie(config: AppConfig) {
  return { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 30 * 24 * 60 * 60_000 };
}

export function authRouter(db: Database, config: AppConfig, verifier: GoogleVerifier): Router {
  const router = Router();

  router.post('/google', asyncRoute(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20).max(10_000) }).parse(req.body);
    const identity = await verifier.verify(credential);
    if (!identity.emailVerified) throw new AppError(401, 'EMAIL_NOT_VERIFIED', 'Use a verified Google account');
    const now = new Date();
    const user = await db.transaction(async (tx) => {
      const existingAccount = (await tx.select({ userId: oauthAccounts.userId }).from(oauthAccounts).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerSubject, identity.sub))).limit(1))[0];
      if (existingAccount) {
        const existing = (await tx.update(users).set({ email: identity.email.toLowerCase(), avatarUrl: identity.picture ?? null, lastActiveAt: now, updatedAt: now }).where(eq(users.id, existingAccount.userId)).returning())[0]!;
        await tx.update(oauthAccounts).set({ emailAtLogin: identity.email.toLowerCase() }).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerSubject, identity.sub)));
        return existing;
      }
      const created = (await tx.insert(users).values({ email: identity.email.toLowerCase(), displayName: identity.name, avatarUrl: identity.picture ?? null }).returning())[0]!;
      await tx.insert(oauthAccounts).values({ userId: created.id, providerSubject: identity.sub, emailAtLogin: identity.email.toLowerCase() });
      await tx.insert(userRoles).values({ userId: created.id, role: 'USER' });
      return created;
    });
    const bootstrap = new Set(config.BOOTSTRAP_ADMIN_EMAILS.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    if (bootstrap.has(user.email.toLowerCase())) await db.insert(userRoles).values({ userId: user.id, role: 'SUPER_ADMIN' }).onConflictDoNothing();
    if (req.cookies?.campus_session) await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, sha256(`${req.cookies.campus_session}:${config.SESSION_SECRET}`)));
    const raw = randomToken();
    await db.insert(sessions).values({ userId: user.id, tokenHash: sha256(`${raw}:${config.SESSION_SECRET}`), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000), userAgent: req.header('user-agent')?.slice(0, 500), ipHash: sha256(req.ip) });
    res.cookie('campus_session', raw, sessionCookie(config));
    res.status(200).json({ data: { onboardingRequired: !user.onboardingComplete } });
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

  router.get('/me', requireAuth, asyncRoute(async (req, res) => {
    const user = (await db.select({ id: users.id, email: users.email, displayName: users.displayName, avatarUrl: users.avatarUrl, institution: users.institution, campus: users.campus, graduationYear: users.graduationYear, phoneVerifiedAt: users.phoneVerifiedAt, phoneE164: users.phoneE164, onboardingComplete: users.onboardingComplete, suspendedAt: users.suspendedAt, createdAt: users.createdAt }).from(users).where(and(eq(users.id, req.auth!.userId), isNull(users.deletedAt))).limit(1))[0];
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
    res.setHeader('cache-control', 'no-store');
    res.json({ data: { ...user, phoneE164: user.phoneE164 ? `${user.phoneE164.slice(0, 3)}******${user.phoneE164.slice(-3)}` : null, roles: req.auth!.roles } });
  }));

  router.patch('/me', requireAuth, asyncRoute(async (req, res) => {
    const input = profileSchema.parse(req.body);
    const updated = (await db.update(users).set({
      displayName: input.displayName,
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.institution !== undefined ? { institution: input.institution } : {}),
      ...(input.campus !== undefined ? { campus: input.campus } : {}),
      ...(input.graduationYear !== undefined ? { graduationYear: input.graduationYear } : {}),
      ...(input.onboardingComplete !== undefined ? { onboardingComplete: input.onboardingComplete } : {}),
      updatedAt: new Date()
    }).where(eq(users.id, req.auth!.userId)).returning({ id: users.id, displayName: users.displayName, onboardingComplete: users.onboardingComplete }))[0]!;
    res.json({ data: updated });
  }));

  return router;
}
