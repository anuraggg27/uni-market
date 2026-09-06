import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { runBackup } from '../../infra/operations/backup.mjs';
import { hashFile } from '../../infra/operations/backup-crypto.mjs';
import { backupPrefix, r2BackupConfiguration, uploadR2Backup } from '../../infra/operations/r2-backups.mjs';

// Opt-in only. CI's ordinary smoke test never contacts Cloudflare.
// Uploads synthetic data, restores bytes downloaded from R2 to a second local
// PostgreSQL cluster, and removes only this invocation's three test objects.
export async function runLiveR2Smoke(backupEnv, directory, report) {
  if (process.env.R2_BACKUP_LIVE_TEST !== 'true') throw new Error('Live R2 test requires explicit opt-in');
  const env = {
    R2_BACKUP_ENDPOINT: process.env.R2_BACKUP_ENDPOINT,
    R2_BACKUP_BUCKET: process.env.R2_BACKUP_BUCKET,
    R2_BACKUP_ACCESS_KEY_ID: process.env.R2_BACKUP_ACCESS_KEY_ID,
    R2_BACKUP_SECRET_ACCESS_KEY: process.env.R2_BACKUP_SECRET_ACCESS_KEY,
    // A unique synthetic run identifier, not a successful GitHub backup run.
    GITHUB_RUN_ID: `${Date.now()}${randomInt(100000, 1000000)}`,
    GITHUB_RUN_ATTEMPT: '1',
  };
  const config = r2BackupConfiguration(env);
  const client = new S3Client(config.client);
  const prefix = backupPrefix(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT);
  const files = ['database.dump.enc', 'manifest.json.enc'];
  const keys = [...files, 'verified.json'].map((name) => `${prefix}${name}`);
  const downloaded = await mkdtemp(join(tmpdir(), 'uni-market-r2-roundtrip-'));
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(30_000) });
  const absent = async (key) => {
    try {
      await send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return false;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return true;
      throw error;
    }
  };
  let ownsPrefix = false;
  try {
    for (const key of keys) assert(await absent(key), 'Refusing to reuse an existing object');
    ownsPrefix = true;
    const receipt = await uploadR2Backup(env, directory, report, client);
    for (const name of files) {
      const response = await send(new GetObjectCommand({ Bucket: config.bucket, Key: `${prefix}${name}` }));
      assert.equal(response.ContentLength, receipt.files[name].bytes);
      const target = join(downloaded, name);
      await pipeline(response.Body, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      assert.equal(await hashFile(target), receipt.files[name].sha256);
    }

    // No credentials in this request: the same objects must not be public.
    const anonymous = await fetch(`${config.client.endpoint}/${config.bucket}/${keys[0]}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    const anonymousStatus = anonymous.status;
    // R2's S3 endpoint reports a missing Authorization header as HTTP 400,
    // InvalidArgument/Authorization, rather than the usual 401 or 403.
    let missingAuthorization = false;
    if (anonymousStatus === 400) {
      const body = await anonymous.text();
      missingAuthorization = /<Code>InvalidArgument<\/Code>/.test(body) && /<Message>Authorization<\/Message>/.test(body);
    } else {
      await anonymous.body?.cancel();
    }
    assert([401, 403].includes(anonymousStatus) || missingAuthorization, `Anonymous backup access was not refused (HTTP ${anonymousStatus})`);

    const maintenance = postgres({ host: '127.0.0.1', port: 5433, username: 'postgres', database: 'postgres', onnotice: () => undefined });
    try { await maintenance`CREATE DATABASE uni_restore_check`; } finally { await maintenance.end(); }
    const restoredReport = await runBackup({ ...backupEnv, BACKUP_INPUT_DIR: downloaded, BACKUP_RESTORE_PORT: '5433' }, true);
    assert.equal(restoredReport.tablesVerified, report.tablesVerified);
    const restored = postgres({ host: '127.0.0.1', port: 5433, username: 'postgres', database: 'uni_restore_check', onnotice: () => undefined });
    try {
      const [user] = await restored`SELECT email FROM users`;
      assert.equal(user.email, 'restore-fixture@example.test');
      const [mail] = await restored`SELECT payload FROM email_outbox`;
      assert.deepEqual(mail.payload, { fixture: true });
    } finally { await restored.end(); }
    console.info(JSON.stringify({
      liveR2Test: 'passed', bucket: config.bucket, prefix,
      encryptedBytes: Object.values(receipt.files).reduce((sum, file) => sum + file.bytes, 0),
      restoredTables: restoredReport.tablesVerified, anonymousStatus,
      syntheticDataOnly: true, productionUntouched: true,
    }));
  } finally {
    try {
      if (ownsPrefix) {
        for (const key of keys) await send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        for (const key of keys) assert(await absent(key), 'Test object cleanup was not confirmed');
        console.info(`Removed only the three synthetic test objects at ${config.bucket}/${prefix}`);
      }
    } finally {
      client.destroy();
      await rm(downloaded, { recursive: true, force: true });
    }
  }
}
