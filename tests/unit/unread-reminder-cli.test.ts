import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('unread reminder CLI exit status', () => {
  it.each([
    { name: 'unknown flag', args: ['--unexpected-flag'] },
    { name: 'invalid target', args: ['--conversation-id', 'invalid'] },
    { name: 'unscoped queue-only', args: ['--queue-only'] },
    { name: 'missing SMTP', args: ['--dry-run'] },
    { name: 'unmigrated isolated database', args: ['--dry-run'], smtpHost: 'smtp.example.test' },
  ])('returns nonzero after cleanup for $name', ({ args, smtpHost }) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/src/jobs/unread-reminders.ts', ...args], {
      // Never inherit a deployed database or deliver mail: dry-run does not
      // create a transport, and all DB access is explicitly isolated in memory.
      env: { ...process.env, NODE_ENV: 'test', DEV_MODE: 'false', DATABASE_URL: 'pglite://:memory:', SMTP_HOST: smtpHost ?? '', LOG_LEVEL: 'info' },
      encoding: 'utf8', timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('unread_reminders_aborted');
    expect(result.stdout).not.toMatch(/postgres(?:ql)?:\/\/|SMTP_PASSWORD|DATA_ENCRYPTION_KEY/);
  });
});
