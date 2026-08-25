import type { RequestHandler } from 'express';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { currentPolicyVersion, requiredOnboardingPolicies, type Role } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { academicDomains, policyAcceptances, sessions, userRoles, users } from '../db/schema.js';
import { sha256, safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export function sessionMiddleware(db: Database, config: AppConfig): RequestHandler {
  return async (req, _res, next) => {
    const raw = req.cookies?.campus_session as string | undefined;
    if (!raw) { next(); return; }
    const rows = await db.select({
      sessionId: sessions.id,
      userId: users.id,
      phoneVerifiedAt: users.phoneVerifiedAt,
      studentEmailDomain: users.studentEmailDomain,
      studentEmailVerifiedAt: users.studentEmailVerifiedAt,
      studentEmailExpiresAt: users.studentEmailExpiresAt,
      adultAttestedAt: users.adultAttestedAt,
      suspendedAt: users.suspendedAt,
      staffVerifiedAt: sessions.staffVerifiedAt
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, sha256(`${raw}:${config.SESSION_SECRET}`)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt), isNull(users.closedAt), isNull(users.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) { next(); return; }
    const [roleRows, acceptanceRows, domainRows] = await Promise.all([
      db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, row.userId)),
      db.select({ policy: policyAcceptances.policy }).from(policyAcceptances).where(and(eq(policyAcceptances.userId, row.userId), eq(policyAcceptances.version, currentPolicyVersion), inArray(policyAcceptances.policy, [...requiredOnboardingPolicies]))),
      row.studentEmailDomain ? db.select({ id: academicDomains.id }).from(academicDomains).where(and(eq(academicDomains.domain, row.studentEmailDomain), eq(academicDomains.active, true))).limit(1) : Promise.resolve([]),
    ]);
    const policiesAccepted = new Set(acceptanceRows.map((item) => item.policy)).size === requiredOnboardingPolicies.length;
    const studentEmailVerified = Boolean(row.studentEmailVerifiedAt && row.studentEmailExpiresAt && row.studentEmailExpiresAt > new Date() && domainRows.length);
    const adultAttested = Boolean(row.adultAttestedAt);
    const roles = roleRows.map((item) => item.role as Role);
    const staffVerified = !roles.some((role) => role !== 'USER') || Boolean(row.staffVerifiedAt && row.staffVerifiedAt > new Date(Date.now() - 8 * 60 * 60_000));
    req.auth = { userId: row.userId, sessionId: row.sessionId, roles, phoneVerified: Boolean(row.phoneVerifiedAt), studentEmailVerified, adultAttested, policiesAccepted, marketplaceEligible: Boolean(row.phoneVerifiedAt) && studentEmailVerified && adultAttested && policiesAccepted, staffVerified, suspended: Boolean(row.suspendedAt) };
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) { next(new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue')); return; }
  next();
};

export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!req.auth) { next(new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue')); return; }
  if (req.auth.suspended) { next(new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account is currently suspended')); return; }
  if (!req.auth.phoneVerified) { next(new AppError(403, 'PHONE_VERIFICATION_REQUIRED', 'Verify your phone number to continue')); return; }
  if (!req.auth.studentEmailVerified) { next(new AppError(403, 'STUDENT_EMAIL_VERIFICATION_REQUIRED', 'Verify an approved student email to continue')); return; }
  if (!req.auth.adultAttested) { next(new AppError(403, 'AGE_ATTESTATION_REQUIRED', 'Confirm that you are at least 18 years old to continue')); return; }
  if (!req.auth.policiesAccepted) { next(new AppError(403, 'POLICY_ACCEPTANCE_REQUIRED', 'Accept the current platform policies to continue')); return; }
  next();
};

export const requireStaffStepUp: RequestHandler = (req, _res, next) => {
  if (!req.auth) { next(new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue')); return; }
  if (req.auth.roles.some((role) => role !== 'USER') && !req.auth.staffVerified) {
    next(new AppError(403, 'STAFF_STEP_UP_REQUIRED', 'Confirm your Google account again to access staff tools'));
    return;
  }
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) { next(new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue')); return; }
    if (!req.auth.roles.some((role) => roles.includes(role))) { next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do that')); return; }
    next();
  };
}

export function csrfProtection(db: Database, config: AppConfig): RequestHandler {
  return async (req, _res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.auth || ['/api/auth/google', '/api/uploads/local'].includes(req.path)) { next(); return; }
    const token = req.header('x-csrf-token');
    if (!token) { next(new AppError(403, 'CSRF_INVALID', 'Refresh the page and try again')); return; }
    const row = (await db.select({ csrfHash: sessions.csrfHash }).from(sessions).where(eq(sessions.id, req.auth.sessionId)).limit(1))[0];
    const actual = sha256(`${token}:${config.CSRF_SECRET}`);
    if (!row?.csrfHash || !safeEqual(row.csrfHash, actual)) { next(new AppError(403, 'CSRF_INVALID', 'Refresh the page and try again')); return; }
    next();
  };
}
