import { Router, type Request } from 'express';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { academicDomains, adminAuditLogs, legalHolds, serviceProviderReviews, staffAccessReviews, userRoles, users } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth, requireRole, requireStaffStepUp } from '../middleware/auth.js';

function adminRole(roles: string[]) {
  return roles.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' as const : roles.includes('SUPPORT_AGENT') ? 'SUPPORT_AGENT' as const : 'MODERATOR' as const;
}

async function audit(db: Database, req: Request, input: { action: string; targetType: string; targetId: string; reason: string; previous?: unknown; next?: unknown }) {
  await db.insert(adminAuditLogs).values({
    adminId: req.auth!.userId,
    role: adminRole(req.auth!.roles),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousState: input.previous as any,
    newState: input.next as any,
    internalReason: input.reason,
    requestId: req.requestId,
    ipHash: sha256(req.ip ?? 'unknown'),
  });
}

export function complianceAdminRouter(db: Database): Router {
  const router = Router();
  router.use(requireAuth, requireStaffStepUp);

  router.get('/academic-domains', requireRole('SUPPORT_AGENT', 'SUPER_ADMIN'), asyncRoute(async (_req, res) => {
    res.json({ data: await db.select().from(academicDomains).orderBy(asc(academicDomains.institutionName)) });
  }));

  router.post('/academic-domains', requireRole('SUPPORT_AGENT', 'SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const input = z.object({ domain: z.string().trim().min(3).max(253).regex(/^[a-z0-9.-]+$/i), institutionName: z.string().trim().min(2).max(160), sourceUrl: z.string().url().max(1000), allowSubdomains: z.boolean().default(false) }).parse(req.body);
    const domain = input.domain.toLowerCase().replace(/^@/, '');
    try {
      const created = (await db.insert(academicDomains).values({ ...input, domain, reviewedBy: req.auth!.userId }).returning())[0]!;
      await audit(db, req, { action: 'ACADEMIC_DOMAIN_CREATE', targetType: 'ACADEMIC_DOMAIN', targetId: created.id, reason: `Official source: ${input.sourceUrl}`, next: created });
      res.status(201).json({ data: created });
    } catch (error: any) {
      if (error?.code === '23505' || String(error?.message).includes('academic_domains_domain_unique')) throw new AppError(409, 'DOMAIN_EXISTS', 'This academic domain already exists');
      throw error;
    }
  }));

  router.patch('/academic-domains/:id', requireRole('SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ active: z.boolean(), sourceUrl: z.string().url().max(1000), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    const previous = (await db.select().from(academicDomains).where(eq(academicDomains.id, id)).limit(1))[0];
    if (!previous) throw new AppError(404, 'DOMAIN_NOT_FOUND', 'Academic domain not found');
    const updated = (await db.update(academicDomains).set({ active: input.active, sourceUrl: input.sourceUrl, reviewedBy: req.auth!.userId, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(academicDomains.id, id)).returning())[0]!;
    await audit(db, req, { action: 'ACADEMIC_DOMAIN_UPDATE', targetType: 'ACADEMIC_DOMAIN', targetId: id, reason: input.reason, previous, next: updated });
    res.json({ data: updated });
  }));

  router.get('/service-providers', requireRole('SUPER_ADMIN'), asyncRoute(async (_req, res) => {
    res.json({ data: await db.select().from(serviceProviderReviews).orderBy(asc(serviceProviderReviews.displayName)) });
  }));

  router.patch('/service-providers/:id', requireRole('SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ region: z.string().trim().min(2).max(200), privacyUrl: z.string().url().max(1000), contractStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']), subprocessorReviewed: z.boolean(), deletionReviewed: z.boolean(), breachTermsReviewed: z.boolean(), evidenceReference: z.string().trim().min(3).max(1000), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    const previous = (await db.select().from(serviceProviderReviews).where(eq(serviceProviderReviews.id, id)).limit(1))[0];
    if (!previous) throw new AppError(404, 'PROVIDER_NOT_FOUND', 'Service provider not found');
    const { reason, ...reviewFields } = input;
    const updated = (await db.update(serviceProviderReviews).set({ ...reviewFields, reviewedBy: req.auth!.userId, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(serviceProviderReviews.id, id)).returning())[0]!;
    await audit(db, req, { action: 'SERVICE_PROVIDER_REVIEW', targetType: 'SERVICE_PROVIDER', targetId: id, reason, previous, next: updated });
    res.json({ data: updated });
  }));

  router.get('/legal-holds', requireRole('SUPER_ADMIN'), asyncRoute(async (_req, res) => {
    res.json({ data: await db.select().from(legalHolds).orderBy(desc(legalHolds.createdAt)) });
  }));

  router.post('/legal-holds', requireRole('SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const input = z.object({ targetType: z.enum(['USER', 'LISTING', 'REPORT', 'TRANSACTION', 'CONVERSATION']), targetId: z.string().uuid(), reason: z.string().trim().min(10).max(2000), reviewAt: z.coerce.date().refine((date) => date > new Date(), 'Review date must be in the future') }).parse(req.body);
    const created = (await db.insert(legalHolds).values({ ...input, createdBy: req.auth!.userId }).returning())[0]!;
    await audit(db, req, { action: 'LEGAL_HOLD_CREATE', targetType: 'LEGAL_HOLD', targetId: created.id, reason: input.reason, next: created });
    res.status(201).json({ data: created });
  }));

  router.post('/legal-holds/:id/release', requireRole('SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(10).max(2000) }).parse(req.body);
    const previous = (await db.select().from(legalHolds).where(and(eq(legalHolds.id, id), isNull(legalHolds.releasedAt))).limit(1))[0];
    if (!previous) throw new AppError(404, 'LEGAL_HOLD_NOT_FOUND', 'Active legal hold not found');
    const updated = (await db.update(legalHolds).set({ releasedAt: new Date(), releasedBy: req.auth!.userId }).where(eq(legalHolds.id, id)).returning())[0]!;
    await audit(db, req, { action: 'LEGAL_HOLD_RELEASE', targetType: 'LEGAL_HOLD', targetId: id, reason, previous, next: updated });
    res.json({ data: updated });
  }));

  router.get('/access-reviews', requireRole('SUPER_ADMIN'), asyncRoute(async (_req, res) => {
    const [staff, reviews] = await Promise.all([
      db.select({ userId: users.id, displayName: users.displayName, email: users.email, role: userRoles.role, lastActiveAt: users.lastActiveAt }).from(userRoles).innerJoin(users, eq(users.id, userRoles.userId)).where(isNull(users.deletedAt)).orderBy(asc(users.email)),
      db.select().from(staffAccessReviews).orderBy(desc(staffAccessReviews.reviewedAt)).limit(100),
    ]);
    res.json({ data: { staff: staff.filter((row) => row.role !== 'USER'), reviews } });
  }));

  router.post('/access-reviews/:userId', requireRole('SUPER_ADMIN'), asyncRoute(async (req, res) => {
    const subjectUserId = z.string().uuid().parse(req.params.userId);
    const input = z.object({ outcome: z.enum(['RETAIN', 'CHANGE_REQUIRED', 'REMOVE']), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, subjectUserId));
    if (!roles.some(({ role }) => role !== 'USER')) throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account not found');
    const review = (await db.insert(staffAccessReviews).values({ subjectUserId, roles: roles.map(({ role }) => role), outcome: input.outcome, reason: input.reason, reviewedBy: req.auth!.userId }).returning())[0]!;
    await audit(db, req, { action: 'STAFF_ACCESS_REVIEW', targetType: 'USER', targetId: subjectUserId, reason: input.reason, next: review });
    res.status(201).json({ data: review });
  }));

  router.get('/compliance/readiness', requireRole('SUPER_ADMIN'), asyncRoute(async (_req, res) => {
    const [domains, providers] = await Promise.all([db.select().from(academicDomains).where(eq(academicDomains.active, true)), db.select().from(serviceProviderReviews)]);
    const incompleteProviders = providers.filter((provider) => provider.contractStatus !== 'APPROVED' || !provider.subprocessorReviewed || !provider.deletionReviewed || !provider.breachTermsReviewed);
    res.json({ data: { ready: domains.length > 0 && providers.length >= 5 && incompleteProviders.length === 0, academicDomains: domains.length, incompleteProviders: incompleteProviders.map((provider) => provider.providerKey) } });
  }));

  return router;
}
