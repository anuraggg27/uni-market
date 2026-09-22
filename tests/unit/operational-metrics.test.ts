import { describe, expect, it } from 'vitest';
import { OperationalMetrics } from '../../apps/api/src/services/operational-metrics';
import { evaluateMetrics, reconcileIncident, probeProduction, checkBackupFreshness } from '../../infra/operations/monitor.mjs';

function healthy() {
  return { version: 1, checkedAt: new Date().toISOString(), windowMinutes: 60,
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    database: { ok: true, email: { failed: 0, pending: 0, oldestPendingSeconds: 0 }, retention: { mode: 'dry-run', latest: { status: 'COMPLETED' }, lastCompletedAt: new Date().toISOString() as string | null } },
    disk: { usedPercent: 20, freeBytes: 10 * 1024 ** 3, inodeUsedPercent: 10 },
    signals: new OperationalMetrics().snapshot(),
  };
}

describe('operational monitoring', () => {
  it('keeps bounded aggregate counts and expires old observations', () => {
    let now = 0;
    const metrics = new OperationalMetrics(() => now);
    metrics.record('otp_provider', false);
    metrics.record('otp_provider', true);
    expect(metrics.snapshot().otp_provider).toEqual({ successes: 1, failures: 1 });
    now = 60 * 60_000;
    expect(metrics.snapshot().otp_provider).toEqual({ successes: 0, failures: 0 });
    metrics.record('email_delivery', false);
    expect(metrics.snapshot().email_delivery.failures).toBe(1);
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(/email@|phone|token|password/);
  });

  it('detects disk, database, OTP, email backlog and exhausted retries', () => {
    const metrics = healthy();
    expect(evaluateMetrics(metrics)).toEqual([]);
    metrics.disk.usedPercent = 90;
    metrics.database.email = { failed: 2, pending: 5, oldestPendingSeconds: 901 };
    metrics.signals.otp_provider.failures = 1;
    metrics.signals.otp_widget.failures = 3;
    expect(evaluateMetrics(metrics)).toHaveLength(5);
    metrics.database.ok = false;
    expect(evaluateMetrics(metrics)).toContain('Database readiness check failed.');
  });

  it('fails closed on stale or incomplete metrics and tolerates an isolated widget rejection', () => {
    expect(evaluateMetrics({})).toHaveLength(1);
    const metrics = healthy();
    metrics.signals.otp_widget.failures = 1;
    expect(evaluateMetrics(metrics)).toEqual([]);
    metrics.checkedAt = new Date(0).toISOString();
    expect(evaluateMetrics(metrics)).toEqual(['Operational metrics are missing, incompatible or stale.']);
  });

  it('alerts on missing, stale and failed retention, with a bounded startup grace period', () => {
    const metrics = healthy();
    metrics.database.retention.lastCompletedAt = null;
    expect(evaluateMetrics(metrics)).toContain('No successful retention run in the last 30 hours.');
    metrics.startedAt = new Date().toISOString();
    expect(evaluateMetrics(metrics)).toEqual([]);
    metrics.database.retention.lastCompletedAt = new Date(Date.now() - 31 * 60 * 60_000).toISOString();
    expect(evaluateMetrics(metrics)).toContain('No successful retention run in the last 30 hours.');
    metrics.database.retention.latest.status = 'FAILED';
    expect(evaluateMetrics(metrics)).toContain('The latest retention run failed; inspect the private retention audit.');
  });

  it('retries public outages and never leaks response bodies into alerts', async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/internal/operations')) return new Response(JSON.stringify(healthy()));
      return new Response('private upstream error with credentials', { status: 500 });
    };
    const issues = await probeProduction('a'.repeat(64), fetcher);
    expect(issues).toHaveLength(2);
    expect(JSON.stringify(issues)).not.toContain('credentials');
  });

  it('creates one incident, suppresses duplicate alerts, and closes on recovery', async () => {
    const writes: any[] = [];
    let issue: any;
    const client = async (route: string, method = 'GET', body?: any) => {
      if (method === 'GET') return issue ? [issue] : [];
      writes.push({ route, method, body });
      if (method === 'POST' && route === 'issues') issue = { number: 7, ...body };
    };
    await reconcileIncident(client, 'Production health', ['Disk low'], 'https://github.com/run/1');
    await reconcileIncident(client, 'Production health', ['Disk low'], 'https://github.com/run/2');
    expect(writes).toHaveLength(1);
    await reconcileIncident(client, 'Production health', [], 'https://github.com/run/3');
    expect(writes.at(-1).body).toEqual({ state: 'closed', state_reason: 'completed' });
  });

  it('distinguishes manual alert tests from automatically recovered incidents', async () => {
    const bodies: string[] = [];
    const client = async (route: string, method = 'GET', body?: any) => {
      if (method === 'GET') return [];
      if (route === 'issues') bodies.push(body.body);
    };

    await reconcileIncident(client, 'Alert delivery test', ['Confirm delivery'], 'https://github.com/run/test');
    await reconcileIncident(client, 'Production health', ['Disk low'], 'https://github.com/run/incident');

    expect(bodies[0]).toContain('This test issue requires manual acknowledgement and closure.');
    expect(bodies[0]).not.toContain('closes automatically');
    expect(bodies[1]).toContain('This issue closes automatically once checks recover.');
  });

  it('requires a recent successful restore and matching private R2 backup objects', async () => {
    const now = Date.now();
    const client = async (route: string) => route.includes('/runs?')
      ? { workflow_runs: [{ id: 1, run_attempt: 2, run_started_at: new Date(now).toISOString() }] }
      : {};
    const verifyStored = async (id: number, attempt: number) => { expect(id).toBe(1); expect(attempt).toBe(2); };
    expect(await checkBackupFreshness(client, now, verifyStored)).toEqual([]);
    expect(await checkBackupFreshness(client, now + 31 * 60 * 60_000, verifyStored)).toHaveLength(1);
    expect(await checkBackupFreshness(async () => ({ workflow_runs: [] }), now, verifyStored)).toHaveLength(1);
    expect(await checkBackupFreshness(client, now, async () => { throw new Error('R2 unavailable'); })).toEqual(['The latest restore-tested backup is missing, changed or inaccessible in private R2 storage.']);
  });
});
