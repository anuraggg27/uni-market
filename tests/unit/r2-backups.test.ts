import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptFile } from '../../infra/operations/backup-crypto.mjs';
import { backupPrefix, r2BackupConfiguration, uploadR2Backup, verifyR2Backup } from '../../infra/operations/r2-backups.mjs';

const env = {
  R2_BACKUP_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, R2_BACKUP_BUCKET: 'uni-market-backups',
  R2_BACKUP_ACCESS_KEY_ID: 'writer-id', R2_BACKUP_SECRET_ACCESS_KEY: 'writer-secret',
  R2_BACKUP_READ_ACCESS_KEY_ID: 'reader-id', R2_BACKUP_READ_SECRET_ACCESS_KEY: 'reader-secret',
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1',
};
const report = () => ({ verified: true, snapshotAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), tablesVerified: 34 });
let directory: string;

function fakeR2() {
  const objects = new Map<string, { bytes: Buffer; metadata: any }>();
  const calls: string[] = [];
  const client = { send: vi.fn(async (command: any) => {
    const input = command.input;
    const name = command.constructor.name;
    calls.push(`${name}:${input.Key}`);
    expect(input.Bucket).toBe('uni-market-backups');
    if (name === 'PutObjectCommand') {
      expect(input.IfNoneMatch).toBe('*');
      expect(input.ACL).toBeUndefined();
      expect(input.StorageClass).toBe('STANDARD');
      if (objects.has(input.Key)) throw new Error('PreconditionFailed');
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(input.Body)) chunks.push(input.Body);
      else for await (const chunk of input.Body) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      expect(bytes.length).toBe(input.ContentLength);
      objects.set(input.Key, { bytes, metadata: input.Metadata });
      return {};
    }
    const object = objects.get(input.Key);
    if (!object) throw new Error('NoSuchKey');
    return { ContentLength: object.bytes.length, Metadata: object.metadata,
      ...(name === 'GetObjectCommand' ? { Body: Readable.from([object.bytes]) } : {}),
    };
  }) };
  return { client, objects, calls };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'uni-r2-backup-test-'));
  const key = randomBytes(32).toString('hex');
  await writeFile(join(directory, 'fixture'), 'private database fixture');
  for (const name of ['database.dump.enc', 'manifest.json.enc']) await encryptFile(join(directory, 'fixture'), join(directory, name), key);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('private R2 database backups', () => {
  it('uses distinct bucket-scoped credentials and forbids unsafe endpoints, paths and photo buckets', () => {
    expect(r2BackupConfiguration(env).client).toMatchObject({ region: 'auto', credentials: { accessKeyId: 'writer-id' } });
    expect(r2BackupConfiguration(env, true).client.credentials.accessKeyId).toBe('reader-id');
    expect(() => r2BackupConfiguration({ ...env, R2_BACKUP_ENDPOINT: 'http://localhost:9000' })).toThrow();
    expect(() => r2BackupConfiguration({ ...env, R2_BACKUP_ENDPOINT: 'https://storage.example.com' })).toThrow();
    expect(() => r2BackupConfiguration({ ...env, R2_BACKUP_BUCKET: 'uni-market-photos' })).toThrow();
    expect(() => r2BackupConfiguration({ ...env, R2_BUCKET_NAME: 'uni-market-backups' })).toThrow();
    expect(() => r2BackupConfiguration({ ...env, R2_BACKUP_READ_ACCESS_KEY_ID: '' }, true)).toThrow();
    expect(() => backupPrefix('../other-prefix', 1)).toThrow();
  });

  it('stores only encrypted files, reads them back and publishes the completion receipt last', async () => {
    const { client, objects, calls } = fakeR2();
    await uploadR2Backup(env, directory, report(), client);
    const prefix = backupPrefix(1234, 1);
    expect([...objects.keys()]).toEqual([`${prefix}database.dump.enc`, `${prefix}manifest.json.enc`, `${prefix}verified.json`]);
    expect(objects.get(`${prefix}database.dump.enc`)!.bytes).toEqual(await readFile(join(directory, 'database.dump.enc')));
    expect(objects.get(`${prefix}database.dump.enc`)!.bytes.toString()).not.toContain('private database fixture');
    expect(calls.indexOf(`PutObjectCommand:${prefix}verified.json`)).toBeGreaterThan(calls.indexOf(`GetObjectCommand:${prefix}manifest.json.enc`));
    const receipt = await verifyR2Backup(env, 1234, 1, client);
    expect(receipt).toMatchObject({ verified: true, tablesVerified: 34 });
    await expect(uploadR2Backup(env, directory, report(), client)).rejects.toThrow('PreconditionFailed');
  });

  it('does not mark a truncated or failed upload complete', async () => {
    const { client, objects } = fakeR2();
    const send = client.send.getMockImplementation()!;
    client.send.mockImplementation(async (command: any) => {
      const result = await send(command);
      if (command.constructor.name === 'GetObjectCommand') return { ...result, Body: Readable.from([Buffer.from('truncated')]) };
      return result;
    });
    await expect(uploadR2Backup(env, directory, report(), client)).rejects.toThrow();
    expect(objects.has(`${backupPrefix(1234, 1)}verified.json`)).toBe(false);
  });

  it('rejects plaintext, an unverified restore and missing stored objects', async () => {
    const { client, objects } = fakeR2();
    await expect(uploadR2Backup(env, directory, { ...report(), verified: false }, client)).rejects.toThrow(/successful restore/);
    await uploadR2Backup(env, directory, report(), client);
    objects.delete(`${backupPrefix(1234, 1)}manifest.json.enc`);
    await expect(verifyR2Backup(env, 1234, 1, client)).rejects.toThrow();
    await writeFile(join(directory, 'database.dump.enc'), 'This is actually plaintext data and must never be uploaded as a backup');
    await expect(uploadR2Backup({ ...env, GITHUB_RUN_ATTEMPT: '2' }, directory, report(), client)).rejects.toThrow(/unencrypted/);
  });

  it('rejects old receipts and objects with changed metadata', async () => {
    const { client, objects } = fakeR2();
    await uploadR2Backup(env, directory, report(), client);
    const prefix = backupPrefix(1234, 1);
    objects.get(`${prefix}database.dump.enc`)!.metadata.sha256 = '0'.repeat(64);
    await expect(verifyR2Backup(env, 1234, 1, client)).rejects.toThrow(/changed/);
    const stored = objects.get(`${prefix}verified.json`)!;
    const receipt = JSON.parse(stored.bytes.toString());
    receipt.snapshotAt = new Date(Date.now() - 31 * 60 * 60_000).toISOString();
    stored.bytes = Buffer.from(JSON.stringify(receipt));
    await expect(verifyR2Backup(env, 1234, 1, client)).rejects.toThrow(/stale/);
  });
});
