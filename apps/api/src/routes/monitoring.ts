import { statfs } from 'node:fs/promises';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { AppConfig } from '../config.js';
import { emailOutbox, retentionRuns } from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { asyncRoute } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { operationalMetrics } from '../services/operational-metrics.js';

export function monitoringRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.get('/api/internal/operations', asyncRoute(async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    const token = /^Bearer ([a-fA-F0-9]{64})$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
    if (!config.MONITORING_TOKEN || !safeEqual(token, config.MONITORING_TOKEN)) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }
    // SQL is bounded server-side; the external monitor also enforces a timeout.
    const database = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '4000ms'`);
      const [email] = await tx.select({
        pending: sql<number>`count(*) FILTER (WHERE sent_at IS NULL AND suppressed_at IS NULL AND failed_at IS NULL AND template <> 'student-email-otp')::int`,
        failed: sql<number>`count(*) FILTER (WHERE failed_at > now() - interval '24 hours' AND sent_at IS NULL AND suppressed_at IS NULL)::int`,
        oldestPendingSeconds: sql<number>`COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE sent_at IS NULL AND suppressed_at IS NULL AND failed_at IS NULL AND template <> 'student-email-otp'))), 0)::int`,
      }).from(emailOutbox);
      const [latest] = await tx.select({ status: retentionRuns.status, startedAt: retentionRuns.startedAt, completedAt: retentionRuns.completedAt }).from(retentionRuns).orderBy(desc(retentionRuns.startedAt)).limit(1);
      const [success] = await tx.select({ completedAt: retentionRuns.completedAt }).from(retentionRuns).where(eq(retentionRuns.status, 'COMPLETED')).orderBy(desc(retentionRuns.completedAt)).limit(1);
      return { email: email!, retention: { mode: config.RETENTION_MODE, latest: latest ?? null, lastCompletedAt: success?.completedAt ?? null } };
    }).then((checks) => ({ ok: true, ...checks })).catch(() => ({ ok: false, email: null, retention: null }));
    const disk = await statfs('/').then((value) => ({
      usedPercent: value.blocks > 0 ? Math.ceil(100 * (1 - value.bavail / value.blocks)) : null,
      freeBytes: value.bavail * value.bsize,
      inodeUsedPercent: value.files > 0 ? Math.ceil(100 * (1 - value.ffree / value.files)) : null,
    })).catch(() => null);
    res.json({
      version: 1,
      checkedAt: new Date().toISOString(),
      startedAt: new Date(operationalMetrics.startedAt).toISOString(),
      database,
      disk,
      windowMinutes: 60,
      signals: operationalMetrics.snapshot(),
    });
  }));
  return router;
}

export function otpTelemetryRouter(): Router {
  const router = Router();
  router.post('/api/operations/otp-event', requireAuth, rateLimit({
    windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
  }), asyncRoute(async (req, res) => {
    const input = z.object({ success: z.boolean() }).strict().parse(req.body);
    operationalMetrics.record('otp_widget', input.success);
    res.status(204).end();
  }));
  return router;
}
