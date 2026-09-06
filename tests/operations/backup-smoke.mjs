import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { runBackup } from '../../infra/operations/backup.mjs';

if (process.argv.includes('--r2') && process.env.R2_BACKUP_LIVE_TEST !== 'true') {
  throw new Error('Live R2 test requires explicit opt-in');
}

// Every connection is hard-coded to this test container's loopback PostgreSQL.
const maintenance = postgres({ host: '127.0.0.1', username: 'postgres', database: 'postgres', onnotice: () => undefined });
await maintenance`CREATE DATABASE uni_backup_source`;
await maintenance`CREATE DATABASE uni_restore_check`;
await maintenance.end();
const source = postgres({ host: '127.0.0.1', username: 'postgres', database: 'uni_backup_source', onnotice: () => undefined });
const directory = await mkdtemp(join(tmpdir(), 'uni-market-smoke-backup-'));
try {
  await migrate(drizzle(source), { migrationsFolder: resolve('apps/api/drizzle') });
  const [user] = await source`INSERT INTO users (email, display_name) VALUES ('restore-fixture@example.test', 'Restore Fixture') RETURNING id`;
  await source`INSERT INTO email_outbox (recipient_user_id, template, payload, dedupe_key) VALUES (${user.id}, 'listing_approved', '{"fixture":true}', 'restore-fixture')`;
  const env = {
    BACKUP_DATABASE_URL: 'postgres://postgres:local-test@127.0.0.1:5432/uni_backup_source?sslmode=disable',
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    BACKUP_RESTORE_ISOLATED: 'true', BACKUP_RESTORE_PASSWORD: 'local-test', BACKUP_OUTPUT_DIR: directory,
  };
  const result = await runBackup(env);
  assert.equal(result.verified, true);
  assert(result.tablesVerified > 20);
  assert.deepEqual((await readdir(directory)).sort(), ['database.dump.enc', 'manifest.json.enc']);
  const restored = postgres({ host: '127.0.0.1', username: 'postgres', database: 'uni_restore_check', onnotice: () => undefined });
  try {
    const [row] = await restored`SELECT email FROM users WHERE id = ${user.id}`;
    assert.equal(row.email, 'restore-fixture@example.test');
    const [mail] = await restored`SELECT payload FROM email_outbox WHERE recipient_user_id = ${user.id}`;
    assert.deepEqual(mail.payload, { fixture: true });
    await assert.rejects(runBackup({ ...env, BACKUP_INPUT_DIR: directory }, true), /must be empty/);
    assert.equal((await source`SELECT count(*)::int AS count FROM users`)[0].count, 1);
  } finally { await restored.end(); }
  if (process.argv.includes('--r2')) {
    const { runLiveR2Smoke } = await import('./r2-backup-smoke.mjs');
    await runLiveR2Smoke(env, directory, result);
  }
  console.info('PASS: migrated database -> encrypted snapshot -> authenticated restore -> matching data; production untouched.');
} finally {
  await source.end();
  await rm(directory, { recursive: true, force: true });
}
