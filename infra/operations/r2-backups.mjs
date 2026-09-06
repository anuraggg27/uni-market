import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { hashFile } from './backup-crypto.mjs';

const files = ['database.dump.enc', 'manifest.json.enc'];
const maxFileBytes = 4 * 1024 ** 3;

export function r2BackupConfiguration(env = process.env, readOnly = false) {
  // Explicit backup-only configuration: never fall back to listing-photo credentials.
  const endpoint = new URL(env.R2_BACKUP_ENDPOINT);
  if (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('R2_BACKUP_ENDPOINT must be a Cloudflare R2 HTTPS account endpoint');
  }
  const bucket = env.R2_BACKUP_BUCKET;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '') || !/(^|-)backups?(-|$)/.test(bucket) || bucket === env.R2_BUCKET_NAME) {
    throw new Error('Use a dedicated private R2 bucket with backup or backups in its name');
  }
  const accessKeyId = readOnly ? env.R2_BACKUP_READ_ACCESS_KEY_ID : env.R2_BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = readOnly ? env.R2_BACKUP_READ_SECRET_ACCESS_KEY : env.R2_BACKUP_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('Dedicated R2 backup credentials are missing');
  return { bucket, client: {
    region: 'auto', endpoint: endpoint.origin, credentials: { accessKeyId, secretAccessKey },
    // A failed streaming PUT needs a fresh stream; fail this run instead of retrying consumed bytes.
    maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  } };
}

export function backupPrefix(runId, attempt) {
  if (!/^[1-9]\d{0,19}$/.test(String(runId)) || !/^[1-9]\d{0,5}$/.test(String(attempt))) throw new Error('A valid GitHub run and attempt are required');
  return `database-backups/${runId}-${attempt}/`;
}

function send(client, command) {
  return client.send(command, { abortSignal: AbortSignal.timeout(120_000) });
}

async function digestBody(body, expectedBytes) {
  if (!body || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxFileBytes) throw new Error('Invalid stored backup size');
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of body) {
    size += chunk.length;
    if (size > expectedBytes) throw new Error('Stored backup exceeds its expected size');
    hash.update(chunk);
  }
  if (size !== expectedBytes) throw new Error('Stored backup is truncated');
  return hash.digest('hex');
}

async function readReceipt(body) {
  if (!body) throw new Error('Missing backup receipt');
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Invalid backup receipt');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function uploadR2Backup(env, directory, report, suppliedClient) {
  const config = r2BackupConfiguration(env);
  const client = suppliedClient ?? new S3Client(config.client);
  const prefix = backupPrefix(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT);
  const receipt = { version: 1, runId: String(env.GITHUB_RUN_ID), attempt: String(env.GITHUB_RUN_ATTEMPT),
    verified: report?.verified, snapshotAt: report?.snapshotAt, verifiedAt: report?.verifiedAt,
    tablesVerified: report?.tablesVerified, files: {},
  };
  if (report?.verified !== true || !Number.isFinite(Date.parse(report.snapshotAt)) || !Number.isFinite(Date.parse(report.verifiedAt)) ||
      !Number.isSafeInteger(report.tablesVerified) || report.tablesVerified < 1) throw new Error('A successful restore report is required before publishing a backup');
  try {
    for (const name of files) {
      const file = join(directory, name);
      const size = (await stat(file)).size;
      if (size < 36 || size > maxFileBytes) throw new Error('Encrypted backup exceeds the supported single-upload size');
      const handle = await open(file, 'r');
      const header = Buffer.alloc(8);
      try { await handle.read(header, 0, 8, 0); } finally { await handle.close(); }
      if (header.toString() !== 'UNIBAK01') throw new Error('Refusing to upload an unencrypted backup');
      const sha256 = await hashFile(file);
      const body = createReadStream(file);
      try {
        await send(client, new PutObjectCommand({ Bucket: config.bucket, Key: `${prefix}${name}`, Body: body,
          ContentLength: size, ContentType: 'application/octet-stream', CacheControl: 'no-store',
          StorageClass: 'STANDARD', IfNoneMatch: '*', Metadata: { sha256 },
        }));
      } finally { body.destroy(); }
      // Validate the bytes R2 actually returns, not just the PUT response or metadata.
      const stored = await send(client, new GetObjectCommand({ Bucket: config.bucket, Key: `${prefix}${name}` }));
      if (stored.ContentLength !== size || await digestBody(stored.Body, size) !== sha256) throw new Error('R2 backup read-back verification failed');
      receipt.files[name] = { bytes: size, sha256 };
    }
    // A partial upload is never considered a completed backup. Publish the receipt last.
    const encoded = Buffer.from(JSON.stringify(receipt));
    await send(client, new PutObjectCommand({ Bucket: config.bucket, Key: `${prefix}verified.json`, Body: encoded,
      ContentLength: encoded.length, ContentType: 'application/json', CacheControl: 'no-store', StorageClass: 'STANDARD', IfNoneMatch: '*',
    }));
    await verifyR2Backup(env, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, client, false);
    console.info(`Verified encrypted backup stored in private R2: ${config.bucket}/${prefix}`);
    return receipt;
  } finally { if (!suppliedClient) client.destroy(); }
}

export async function verifyR2Backup(env, runId, attempt, suppliedClient, readOnly = true) {
  const config = r2BackupConfiguration(env, readOnly);
  const client = suppliedClient ?? new S3Client(config.client);
  const prefix = backupPrefix(runId, attempt);
  try {
    const object = await send(client, new GetObjectCommand({ Bucket: config.bucket, Key: `${prefix}verified.json` }));
    const receipt = await readReceipt(object.Body);
    const snapshotAt = Date.parse(receipt.snapshotAt);
    const verifiedAt = Date.parse(receipt.verifiedAt);
    if (receipt.version !== 1 || receipt.verified !== true || receipt.runId !== String(runId) || receipt.attempt !== String(attempt) ||
        !Number.isFinite(snapshotAt) || !Number.isFinite(verifiedAt) || snapshotAt > verifiedAt || verifiedAt > Date.now() + 5 * 60_000 ||
        Date.now() - snapshotAt > 30 * 60 * 60_000) throw new Error('R2 restore-verification receipt is stale or invalid');
    for (const name of files) {
      const expected = receipt.files?.[name];
      if (!Number.isSafeInteger(expected?.bytes) || expected.bytes < 36 || expected.bytes > maxFileBytes || !/^[a-f0-9]{64}$/.test(expected.sha256 ?? '')) throw new Error('Invalid R2 backup receipt');
      const head = await send(client, new HeadObjectCommand({ Bucket: config.bucket, Key: `${prefix}${name}` }));
      if (head.ContentLength !== expected.bytes || head.Metadata?.sha256 !== expected.sha256) throw new Error('A verified R2 backup object is missing or changed');
    }
    return receipt;
  } finally { if (!suppliedClient) client.destroy(); }
}
