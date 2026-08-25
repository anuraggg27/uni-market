import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { reportReasons, type Role } from '@campus-market/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { adminAuditLogs, emailOutbox, reportEvents, reports } from '../db/schema.js';
import { decryptText, encryptText, sha256 } from '../lib/crypto.js';
import { grievanceClock, grievanceTracking, verifyTracking } from '../lib/grievance.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth, requireRole, requireStaffStepUp } from '../middleware/auth.js';
import { adaptiveTurnstile } from '../middleware/adaptive-turnstile.js';
import { directEmailJob } from '../services/email-outbox.js';

const basePublicInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  reason: z.enum(reportReasons),
  affectedPerson: z.boolean().default(false),
  targetUrl: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().url().max(1000).optional()),
  details: z.string().trim().min(20).max(5000),
  authorityDeclaration: z.boolean().optional(),
});

const trackingInput = z.object({
  reference: z.string().trim().min(8).max(80).transform((value) => value.toUpperCase()),
  secret: z.string().trim().min(20).max(200),
});

function publicInput(config: AppConfig) {
  const platformHostname = new URL(config.CLIENT_URL).hostname.toLowerCase();
  const canonicalHostname = platformHostname.replace(/^www\./, '');
  return basePublicInput.superRefine((value, context) => {
    const target = value.targetUrl ? new URL(value.targetUrl) : null;
    if (target && (!['http:', 'https:'].includes(target.protocol) || target.hostname.toLowerCase().replace(/^www\./, '') !== canonicalHostname)) {
      context.addIssue({ code: 'custom', path: ['targetUrl'], message: `Enter a ${platformHostname} link` });
    }
    if (value.reason === 'COURT_GOVERNMENT_ORDER' && !value.authorityDeclaration) {
      context.addIssue({ code: 'custom', path: ['authorityDeclaration'], message: 'Confirm that you are authorised to submit this notice' });
    }
  });
}

function staffRole(req: Request): Role {
  if (req.auth!.roles.includes('SUPER_ADMIN')) return 'SUPER_ADMIN';
  if (req.auth!.roles.includes('MODERATOR')) return 'MODERATOR';
  return 'SUPPORT_AGENT';
}

function allowedCategories(req: Request): string[] {
  if (req.auth!.roles.includes('SUPER_ADMIN')) return ['GENERAL', 'UNLAWFUL_CONTENT', 'VICTIM_CONTENT', 'CHILD_SAFETY', 'COURT_GOVERNMENT_ORDER'];
  if (req.auth!.roles.includes('MODERATOR')) return ['UNLAWFUL_CONTENT', 'VICTIM_CONTENT', 'CHILD_SAFETY'];
  return ['GENERAL'];
}

function eventMessage(value: string | null, ciphertext: string | null, config: AppConfig): string | null {
  return ciphertext ? decryptText(ciphertext, config.DATA_ENCRYPTION_KEY) : value;
}

function publicCase(row: typeof reports.$inferSelect, events: Array<typeof reportEvents.$inferSelect>, config: AppConfig) {
  return {
    reference: row.publicReference,
    status: row.appealedAt && !row.resolvedAt ? 'APPEALED' : row.status,
    category: row.category,
    priority: row.priority,
    acknowledgedAt: row.acknowledgedAt,
    actionDueAt: row.actionDueAt,
    resolvedAt: row.resolvedAt,
    response: eventMessage(row.publicResponse, row.publicResponseCiphertext, config),
    events: events.map((event) => ({
      type: event.eventType,
      message: eventMessage(event.publicMessage, event.publicMessageCiphertext, config),
      createdAt: event.createdAt,
    })).filter((event): event is typeof event & { message: string } => Boolean(event.message)),
  };
}

function staffCase(row: typeof reports.$inferSelect, events: Array<typeof reportEvents.$inferSelect>, config: AppConfig) {
  const { targetUrlCiphertext, detailsCiphertext } = row;
  const safe = Object.fromEntries(
    Object.entries(row).filter(([key]) => !['trackingHash', 'reporterEmailCiphertext', 'targetUrlCiphertext', 'detailsCiphertext', 'publicResponseCiphertext'].includes(key)),
  );
  return {
    ...safe,
    targetUrl: targetUrlCiphertext ? decryptText(targetUrlCiphertext, config.DATA_ENCRYPTION_KEY) : row.targetUrl,
    details: detailsCiphertext ? decryptText(detailsCiphertext, config.DATA_ENCRYPTION_KEY) : row.details,
    publicResponse: eventMessage(row.publicResponse, row.publicResponseCiphertext, config),
    events: events.map((event) => ({
      id: event.id,
      type: event.eventType,
      publicMessage: eventMessage(event.publicMessage, event.publicMessageCiphertext, config),
      internalMessage: eventMessage(event.internalMessage, event.internalMessageCiphertext, config),
      createdAt: event.createdAt,
      actorUserId: event.actorUserId,
    })),
  };
}

export function grievanceRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  const publicLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.NODE_ENV === 'test' ? 1_000 : 40,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const submitLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: config.NODE_ENV === 'test' ? 1_000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/grievances', publicLimiter, submitLimiter, adaptiveTurnstile(config, { threshold: 1, windowMs: 60 * 60_000 }), asyncRoute(async (req, res) => {
    const input = publicInput(config).parse(req.body);
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
        targetType: input.targetUrl ? 'URL' : 'PLATFORM',
        targetUrlCiphertext: input.targetUrl ? encryptText(input.targetUrl, config.DATA_ENCRYPTION_KEY) : null,
        reason: input.reason,
        detailsCiphertext: encryptText(input.details, config.DATA_ENCRYPTION_KEY),
        acknowledgeDueAt: clock.acknowledgeDueAt,
        actionDueAt: clock.actionDueAt,
      }).returning())[0]!;
      await tx.insert(reportEvents).values({ reportId: report.id, actorUserId: req.auth?.userId ?? null, eventType: 'SUBMITTED', publicMessage: 'Your grievance was received and queued for review.' });
      await tx.insert(emailOutbox).values([
        directEmailJob(config, { recipientEmail: input.email, template: 'grievance-received', payload: { reference: tracking.publicReference, trackingSecret: tracking.trackingSecret }, dedupeKey: `grievance-received:${report.id}` }),
        directEmailJob(config, { recipientEmail: config.GRIEVANCE_EMAIL, template: 'grievance-new-internal', payload: { reference: tracking.publicReference, category: clock.category, actionDueAt: report.actionDueAt.toISOString(), adminUrl: `${config.CLIENT_URL}/admin/grievances` }, dedupeKey: `grievance-new-internal:${report.id}` }),
      ]).onConflictDoNothing();
      return report;
    });
    res.status(201).json({ data: { reference: tracking.publicReference, trackingSecret: tracking.trackingSecret, acknowledgeDueAt: created.acknowledgeDueAt, actionDueAt: created.actionDueAt } });
  }));

  router.post('/grievances/track', publicLimiter, asyncRoute(async (req, res) => {
    const input = trackingInput.parse(req.body);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, input.reference)).limit(1))[0];
    if (!report || !verifyTracking(input.reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, report.id)).orderBy(asc(reportEvents.createdAt));
    res.setHeader('cache-control', 'no-store');
    res.json({ data: publicCase(report, events, config) });
  }));

  router.post('/grievances/:reference/messages', publicLimiter, asyncRoute(async (req, res) => {
    const input = trackingInput.omit({ reference: true }).extend({ message: z.string().trim().min(2).max(5000) }).parse(req.body);
    const reference = z.string().trim().min(8).max(80).transform((value) => value.toUpperCase()).parse(req.params.reference);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, reference)).limit(1))[0];
    if (!report || !verifyTracking(reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    await db.transaction(async (tx) => {
      const current = (await tx.update(reports).set({ updatedAt: new Date() }).where(and(eq(reports.id, report.id), inArray(reports.status, ['OPEN', 'INVESTIGATING']))).returning({ id: reports.id }))[0];
      if (!current) throw new AppError(409, 'GRIEVANCE_CLOSED', 'This grievance is closed. Submit an appeal instead.');
      const event = (await tx.insert(reportEvents).values({ reportId: report.id, eventType: 'REPORTER_MESSAGE', publicMessageCiphertext: encryptText(input.message, config.DATA_ENCRYPTION_KEY) }).returning({ id: reportEvents.id }))[0]!;
      await tx.insert(emailOutbox).values(directEmailJob(config, { recipientEmail: config.GRIEVANCE_EMAIL, template: 'grievance-follow-up-internal', payload: { reference, adminUrl: `${config.CLIENT_URL}/admin/grievances` }, dedupeKey: `grievance-follow-up:${event.id}` })).onConflictDoNothing();
    });
    res.status(201).json({ data: { received: true } });
  }));

  router.post('/grievances/:reference/appeal', publicLimiter, asyncRoute(async (req, res) => {
    const input = trackingInput.omit({ reference: true }).extend({ reason: z.string().trim().min(10).max(5000) }).parse(req.body);
    const reference = z.string().trim().min(8).max(80).transform((value) => value.toUpperCase()).parse(req.params.reference);
    const report = (await db.select().from(reports).where(eq(reports.publicReference, reference)).limit(1))[0];
    if (!report || !verifyTracking(reference, input.secret, report.trackingHash, config.SESSION_SECRET)) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'The grievance reference or tracking secret is invalid');
    const now = new Date();
    const clock = grievanceClock(report.reason, now);
    await db.transaction(async (tx) => {
      const appealed = (await tx.update(reports).set({ status: 'INVESTIGATING', priority: clock.priority, acknowledgeDueAt: clock.acknowledgeDueAt, actionDueAt: clock.actionDueAt, acknowledgedAt: null, appealedAt: now, resolvedAt: null, purgeAfter: null, publicResponse: null, publicResponseCiphertext: null, assignedTo: null, updatedAt: now }).where(and(eq(reports.id, report.id), inArray(reports.status, ['RESOLVED', 'DISMISSED']))).returning({ id: reports.id }))[0];
      if (!appealed) throw new AppError(409, 'GRIEVANCE_NOT_RESOLVED', 'This grievance has not been resolved yet');
      const event = (await tx.insert(reportEvents).values({ reportId: report.id, eventType: 'APPEALED', publicMessage: 'Your appeal was received for further review.', internalMessageCiphertext: encryptText(input.reason, config.DATA_ENCRYPTION_KEY) }).returning({ id: reportEvents.id }))[0]!;
      await tx.insert(emailOutbox).values(directEmailJob(config, { recipientEmail: config.GRIEVANCE_EMAIL, template: 'grievance-appeal-internal', payload: { reference, actionDueAt: clock.actionDueAt.toISOString(), adminUrl: `${config.CLIENT_URL}/admin/grievances` }, dedupeKey: `grievance-appeal:${event.id}` })).onConflictDoNothing();
    });
    res.status(201).json({ data: { appealed: true } });
  }));

  return router;
}

export function grievanceAdminRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth, requireStaffStepUp, requireRole('SUPPORT_AGENT', 'MODERATOR', 'SUPER_ADMIN'));

  router.get('/grievances', asyncRoute(async (req, res) => {
    const rows = await db.select({
      id: reports.id,
      publicReference: reports.publicReference,
      category: reports.category,
      priority: reports.priority,
      reason: reports.reason,
      status: reports.status,
      assignedTo: reports.assignedTo,
      acknowledgeDueAt: reports.acknowledgeDueAt,
      actionDueAt: reports.actionDueAt,
      acknowledgedAt: reports.acknowledgedAt,
      appealedAt: reports.appealedAt,
      createdAt: reports.createdAt,
    }).from(reports).where(and(inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowedCategories(req)))).orderBy(asc(reports.actionDueAt));
    res.json({ data: rows.map((row) => ({ ...row, overdue: row.actionDueAt < new Date() })) });
  }));

  router.get('/grievances/:id', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const report = (await db.select().from(reports).where(and(eq(reports.id, id), inArray(reports.category, allowedCategories(req)))).limit(1))[0];
    if (!report) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'Grievance not found');
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, id)).orderBy(asc(reportEvents.createdAt));
    await db.insert(adminAuditLogs).values({ adminId: req.auth!.userId, role: staffRole(req), action: 'VIEW_GRIEVANCE', targetType: 'REPORT', targetId: id, internalReason: 'Grievance investigation', requestId: req.requestId, ipHash: sha256(req.ip) });
    res.setHeader('cache-control', 'no-store');
    res.json({ data: staffCase(report, events, config) });
  }));

  router.post('/grievances/:id/acknowledge', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const report = (await tx.update(reports).set({ acknowledgedAt: now, assignedTo: req.auth!.userId, status: 'INVESTIGATING', updatedAt: now }).where(and(eq(reports.id, id), isNull(reports.acknowledgedAt), inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowedCategories(req)))).returning())[0];
      if (!report) throw new AppError(409, 'GRIEVANCE_ALREADY_ACKNOWLEDGED', 'This grievance was already acknowledged or is no longer available');
      const event = (await tx.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: 'ACKNOWLEDGED', publicMessage: 'Your grievance has been acknowledged and assigned for review.' }).returning({ id: reportEvents.id }))[0]!;
      await tx.insert(adminAuditLogs).values({ adminId: req.auth!.userId, role: staffRole(req), action: 'GRIEVANCE_ACKNOWLEDGED', targetType: 'REPORT', targetId: id, previousState: { status: 'OPEN' }, newState: { status: 'INVESTIGATING', acknowledgedAt: now }, internalReason: 'Grievance acknowledged and assigned', requestId: req.requestId, ipHash: sha256(req.ip) });
      if (report.reporterEmailCiphertext) await tx.insert(emailOutbox).values(directEmailJob(config, { recipientEmail: decryptText(report.reporterEmailCiphertext, config.DATA_ENCRYPTION_KEY), template: 'grievance-response', payload: { reference: report.publicReference }, dedupeKey: `grievance-acknowledged:${event.id}` })).onConflictDoNothing();
    });
    res.json({ data: { acknowledgedAt: now } });
  }));

  router.post('/grievances/:id/messages', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ publicMessage: z.string().trim().min(3).max(3000), internalReason: z.string().trim().min(3).max(3000) }).parse(req.body);
    await db.transaction(async (tx) => {
      const report = (await tx.update(reports).set({ updatedAt: new Date() }).where(and(eq(reports.id, id), inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowedCategories(req)))).returning())[0];
      if (!report) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'Open grievance not found');
      const event = (await tx.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: 'STAFF_MESSAGE', publicMessageCiphertext: encryptText(input.publicMessage, config.DATA_ENCRYPTION_KEY), internalMessageCiphertext: encryptText(input.internalReason, config.DATA_ENCRYPTION_KEY) }).returning({ id: reportEvents.id }))[0]!;
      if (report.reporterEmailCiphertext) await tx.insert(emailOutbox).values(directEmailJob(config, { recipientEmail: decryptText(report.reporterEmailCiphertext, config.DATA_ENCRYPTION_KEY), template: 'grievance-response', payload: { reference: report.publicReference }, dedupeKey: `grievance-staff-message:${event.id}` })).onConflictDoNothing();
      await tx.insert(adminAuditLogs).values({ adminId: req.auth!.userId, role: staffRole(req), action: 'GRIEVANCE_UPDATE', targetType: 'REPORT', targetId: id, internalReason: 'Encrypted interim update recorded in case event', requestId: req.requestId, ipHash: sha256(req.ip) });
    });
    res.status(201).json({ data: { sent: true } });
  }));

  router.post('/grievances/:id/resolve', asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ outcome: z.enum(['RESOLVED', 'DISMISSED']), publicResponse: z.string().trim().min(3).max(3000), internalReason: z.string().trim().min(3).max(3000) }).parse(req.body);
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + config.GRIEVANCE_RETENTION_DAYS * 24 * 60 * 60_000);
    const previous = (await db.select().from(reports).where(and(eq(reports.id, id), inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowedCategories(req)))).limit(1))[0];
    if (!previous) throw new AppError(404, 'GRIEVANCE_NOT_FOUND', 'Open grievance not found');
    await db.transaction(async (tx) => {
      const resolved = (await tx.update(reports).set({ status: input.outcome, resolvedAt: now, purgeAfter, publicResponse: null, publicResponseCiphertext: encryptText(input.publicResponse, config.DATA_ENCRYPTION_KEY), assignedTo: req.auth!.userId, updatedAt: now }).where(and(eq(reports.id, id), inArray(reports.status, ['OPEN', 'INVESTIGATING']), inArray(reports.category, allowedCategories(req)))).returning())[0];
      if (!resolved) throw new AppError(409, 'GRIEVANCE_ALREADY_RESOLVED', 'This grievance was already resolved or is no longer available');
      const event = (await tx.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: input.outcome, publicMessageCiphertext: encryptText(input.publicResponse, config.DATA_ENCRYPTION_KEY), internalMessageCiphertext: encryptText(input.internalReason, config.DATA_ENCRYPTION_KEY) }).returning({ id: reportEvents.id }))[0]!;
      await tx.insert(adminAuditLogs).values({ adminId: req.auth!.userId, role: staffRole(req), action: `GRIEVANCE_${input.outcome}`, targetType: 'REPORT', targetId: id, previousState: { status: previous.status }, newState: { status: input.outcome, purgeAfter }, internalReason: 'Encrypted decision rationale recorded in case event', requestId: req.requestId, ipHash: sha256(req.ip) });
      if (resolved.reporterEmailCiphertext) await tx.insert(emailOutbox).values(directEmailJob(config, { recipientEmail: decryptText(resolved.reporterEmailCiphertext, config.DATA_ENCRYPTION_KEY), template: 'grievance-response', payload: { reference: resolved.publicReference }, dedupeKey: `grievance-response:${event.id}` })).onConflictDoNothing();
    });
    res.json({ data: { status: input.outcome, resolvedAt: now } });
  }));

  return router;
}
