import type { RequestHandler } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Role } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { sessions, userRoles, users } from '../db/schema.js';
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
      suspendedAt: users.suspendedAt
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, sha256(`${raw}:${config.SESSION_SECRET}`)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt))).limit(1);
    const row = rows[0];
    if (!row) { next(); return; }
    const roleRows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, row.userId));
    req.auth = { userId: row.userId, sessionId: row.sessionId, roles: roleRows.map((item) => item.role as Role), phoneVerified: Boolean(row.phoneVerifiedAt), suspended: Boolean(row.suspendedAt) };
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
