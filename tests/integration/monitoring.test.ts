import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setup, login } from './helper';
import { emailOutbox } from '../../apps/api/src/db/schema';

describe('private operational probes', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { ctx = await setup(); ctx.config.MONITORING_TOKEN = 'a'.repeat(64); });
  afterAll(async () => { await ctx.client.close(); });

  it('does not expose metrics to anonymous visitors or ordinary signed-in users', async () => {
    await request(ctx.app).get('/api/internal/operations').expect(404);
    await request(ctx.app).get('/api/internal/operations').set('Authorization', 'Bearer wrong').expect(404);
    const auth = await login(ctx.app, 'monitor-normal-user');
    await auth.agent.get('/api/internal/operations').expect(404);
  });

  it('returns aggregate queue and disk health, without customer data or errors', async () => {
    await ctx.db.insert(emailOutbox).values([
      { template: 'listing_approved', payload: { private: 'must-not-leak' }, dedupeKey: 'monitor-delayed', createdAt: new Date(Date.now() - 20 * 60_000) },
      { template: 'listing_approved', payload: {}, dedupeKey: 'monitor-failed', failedAt: new Date(), lastError: 'smtp-secret-error' },
      { template: 'student-email-otp', payload: {}, dedupeKey: 'monitor-legacy', createdAt: new Date(0) },
    ]);
    const response = await request(ctx.app).get('/api/internal/operations').set('Authorization', `Bearer ${ctx.config.MONITORING_TOKEN}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.database).toMatchObject({ ok: true, email: { failed: 1, pending: 1 } });
    expect(response.body.database.email.oldestPendingSeconds).toBeGreaterThanOrEqual(1200);
    expect(response.body.disk.freeBytes).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toMatch(/must-not-leak|smtp-secret-error|monitor-normal-user/);
  });

  it('authenticates and strictly validates browser telemetry with CSRF protection', async () => {
    await request(ctx.app).post('/api/operations/otp-event').send({ success: false }).expect(401);
    const auth = await login(ctx.app, 'monitor-telemetry-user');
    await auth.agent.post('/api/operations/otp-event').send({ success: false }).expect(403);
    await auth.agent.post('/api/operations/otp-event').set(auth.headers).send({ success: false, email: 'do-not-store@example.com' }).expect(400);
    await auth.agent.post('/api/operations/otp-event').set(auth.headers).send({ success: false }).expect(204);
  });

  it('reports a database failure without leaking diagnostics or requiring a session', async () => {
    const transaction = vi.spyOn(ctx.db, 'transaction').mockRejectedValueOnce(new Error('private database connection string'));
    try {
      const response = await request(ctx.app).get('/api/internal/operations').set('Authorization', `Bearer ${ctx.config.MONITORING_TOKEN}`).expect(200);
      expect(response.body.database).toEqual({ ok: false, email: null });
      expect(JSON.stringify(response.body)).not.toContain('private database');
    } finally { transaction.mockRestore(); }
  });
});
