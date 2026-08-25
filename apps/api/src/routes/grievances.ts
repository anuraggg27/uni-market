import { Router } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { reportReasons } from '@campus-market/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { adminAuditLogs, reportEvents, reports } from '../db/schema.js';
import { decryptText, encryptText, sha256 } from '../lib/crypto.js';
import { grievanceClock, grievanceTracking, verifyTracking } from '../lib/grievance.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth, requireRole, requireStaffStepUp } from '../middleware/auth.js';
import { queueDirectEmail } from '../services/email-outbox.js';

const publicInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  reason: z.enum(reportReasons),
  affectedPerson: z.boolean().default(false),
  targetUrl: z.string().trim().url().max(1000),
  details: z.string().trim().min(20).max(5000),
  authorityDeclaration: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.reason === 'COURT_GOVERNMENT_ORDER' && !value.authorityDeclaration) context.addIssue({ code: 'custom', path: ['authorityDeclaration'], message: 'Confirm that you are authorised to submit this notice' });
});

const trackingInput = z.object({ reference: z.string().min(8).max(80), secret: z.string().min(20).max(200) });

function publicCase(row: typeof reports.$inferSelect, events: Array<typeof reportEvents.$inferSelect>) {
  return {
    reference: row.publicReference,
    status: row.appealedAt && !row.resolvedAt ? 'APPEALED' : row.status,
    category: row.category,
    priority: row.priority,
    acknowledgedAt: row.acknowledgedAt,
    actionDueAt: row.actionDueAt,
    resolvedAt: row.resolvedAt,
    response: row.publicResponse,
    events: events.filter((event) => event.publicMessage).map((event) => ({ type: event.eventType, message: event.publicMessage, createdAt: event.createdAt })),
  };
}

export function grievanceRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.post('/grievances', asyncRoute(async (req, res) => {
    const input = publicInput.parse(req.body);
    const now = new Date();
    const tracking = grievanceTracking(config.SESSION_SECRET);
    const clock = grievanceClock(input.reason, now);
    const created = await db.transaction(async (tx) => {
      const report = (await tx.insert(reports).values({
        reporterId: req.auth?.userId ?? null,
        reporterEmailCiphertext: encryptText(input.email, config.DATA_ENCRYPTION_KEY),
        publicReference: tracking.publicReference,
        trackingHash: tracking.trackingHash,
        category: clock.category,
        priority: clock.priority,
        affectedPerson: input.affectedPerson,
        targetType: 'URL',
        targetUrl: input.targetUrl,
        reason: input.reason,
        details: input.details,
        acknowledgeDueAt: clock.acknowledgeDueAt,
        actionDueAt: clock.actionDueAt,
      }).returning())[0]!;
      await tx.insert(reportEvents).values({ reportId: report.id, actorUserId: req.auth?.userId ?? null, eventType: 'SUBMITTED', publicMessage: 'Your grievance was received and queued for review.' });
      return report;
    });
    await queueDirectEmail(db, config, { recipientEmail: input.email, template: 'grievance-received', payload: { reference: tracking.publicReference, trackingSecret: tracking.trackingSecret }, dedupeKey: `grievance-received:${created.id}` });
    res.status(201).json({ data: { reference: tracking.publicReference, trackingSecret: tracking.trackingSecret, acknowledgeDueAt: created.acknowledgeDueAt, actionDueAt: created.actionDueAt } });
  }));

  router.post('/grievances/track', asyncRoute(async (req, res) => {
    const input = trackingInput.parse(req.body);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, input.reference)).limit(1))[0];
    if (!report || !verifyTracking(input.reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, report.id)).orderBy(asc(reportEvents.createdAt));
    res.setHeader('cache-control', 'no-store');
    res.json({ data: publicCase(report, events) });
  }));

  router.post('/grievances/:reference/messages', asyncRoute(async (req, res) => {
    const input = trackingInput.omit({ reference: true }).extend({ message: z.string().trim().min(2).max(5000) }).parse(req.body);
    const reference = z.string().min(8).max(80).parse(req.params.reference);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, reference)).limit(1))[0];
    if (!report || !verifyTracking(reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    await db.insert(reportEvents).values({ reportId: report.id, eventType: 'REPORTER_MESSAGE', publicMessage: input.message });
    res.status(201).json({ data: { received: true } });
  }));

  router.post('/grievances/:reference/appeal', asyncRoute(async (req, res) => {
    const input = trackingInput.omit({ reference: true }).extend({ reason: z.string().trim().min(10).max(5000) }).parse(req.body);
    const reference = z.string().min(8).max(80).parse(req.params.reference);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, reference)).limit(1))[0];
    if (!report || !verifyTracking(reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    if (!report.resolvedAt) throw new AppError(409, 'GRIEVANCE_NOT_RESOLVED', 'This grievance has not been resolved yet');
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(reports).set({ status: 'INVESTIGATING', appealedAt: now, resolvedAt: null, assignedTo: null, updatedAt: now }).where(eq(reports.id, report.id));
      await tx.insert(reportEvents).values({ reportId: report.id, eventType: 'APPEALED', publicMessage: 'Your appeal was received for further review.', internalMessage: input.reason });
    });
    res.status(201).json({ data: { appealed: true } });
  }));

  return router;
}

export function grievanceAdminRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth, requireStaffStepUp, requireRole('SUPPORT_AGENT', 'MODERATOR', 'SUPER_ADMIN'));

  router.get('/grievances', asyncRoute(async (req, res) => {
    const allowed = req.auth!.roles.includes('SUPER_ADMIN')
      ? ['GENERAL', 'UNLAWFUL_CONTENT', 'VICTIM_CONTENT', 'CHILD_SAFETY', 'COURT_GOVERNMENT_ORDER']
      : req.auth!.roles.includes('MODERATOR')
        ? ['UNLAWFUL_CONTENT', 'VICTIM_CONTENT', 'CHILD_SAFETY']
        : ['GENERAL'];
    const rows = await db.select().from(reports).where(and(inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowed))).orderBy(asc(reports.actionDueAt));
    res.json({ data: rows.map((row) => ({ ...row, trackingHash: undefined, reporterEmailCiphertext: undefined, overdue: row.actionDueAt < new Date() })) });
  }));

  router.post('/grievances/:id/acknowledge', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const now = new Date();
    const report = (await db.update(reports).set({ acknowledgedAt: now, assignedTo: req.auth!.userId, status: 'INVESTIGATING', updatedAt: now }).where(eq(reports.id, id)).returning())[0];
    if (!report) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'Grievance not found');
    await db.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: 'ACKNOWLEDGED', publicMessage: 'Your grievance has been acknowledged and assigned for review.' });
    res.json({ data: { acknowledgedAt: now } });
  }));

  router.post('/grievances/:id/resolve', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ outcome: z.enum(['RESOLVED', 'DISMISSED']), publicResponse: z.string().trim().min(3).max(3000), internalReason: z.string().trim().min(3).max(3000) }).parse(req.body);
    const now = new Date();
    const previous = (await db.select().from(reports).where(eq(reports.id, id)).limit(1))[0];
    if (!previous) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'Grievance not found');
    await db.transaction(async (tx) => {
      await tx.update(reports).set({ status: input.outcome, resolvedAt: now, publicResponse: input.publicResponse, assignedTo: req.auth!.userId, updatedAt: now }).where(eq(reports.id, id));
      await tx.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: input.outcome, publicMessage: input.publicResponse, internalMessage: input.internalReason });
      await tx.insert(adminAuditLogs).values({ adminId: req.auth!.userId, role: req.auth!.roles.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : req.auth!.roles.includes('MODERATOR') ? 'MODERATOR' : 'SUPPORT_AGENT', action: `GRIEVANCE_${input.outcome}`, targetType: 'REPORT', targetId: id, previousState: { status: previous.status }, newState: { status: input.outcome }, internalReason: input.internalReason, userVisibleReason: input.publicResponse, requestId: req.requestId, ipHash: sha256(req.ip) });
    });
    if (previous.reporterEmailCiphertext) {
      await queueDirectEmail(db, config, {
        recipientEmail: decryptText(previous.reporterEmailCiphertext, config.DATA_ENCRYPTION_KEY),
        template: 'grievance-response',
        payload: { reference: previous.publicReference },
        dedupeKey: `grievance-response:${id}:${now.toISOString()}`,
      });
    }
    res.json({ data: { status: input.outcome, resolvedAt: now } });
  }));

  return router;
}
