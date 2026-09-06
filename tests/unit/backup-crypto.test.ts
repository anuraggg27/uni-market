import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, hashFile } from '../../infra/operations/backup-crypto.mjs';
import { restoreEnvironment, sourceEnvironment } from '../../infra/operations/backup.mjs';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'uni-backup-crypto-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('authenticated database backups', () => {
  it('restores exact bytes and gives every encryption a new nonce', async () => {
    const key = randomBytes(32).toString('hex');
    const input = join(directory, 'plain');
    const first = join(directory, 'first.enc');
    const second = join(directory, 'second.enc');
    const output = join(directory, 'restored');
    await writeFile(input, randomBytes(1024 * 128));
    await encryptFile(input, first, key);
    await encryptFile(input, second, key);
    expect(await hashFile(first)).not.toBe(await hashFile(second));
    await decryptFile(first, output, key);
    expect(await hashFile(input)).toBe(await hashFile(output));
  });

  it('rejects wrong keys and modified ciphertext without leaving plaintext', async () => {
    const key = randomBytes(32).toString('hex');
    const input = join(directory, 'plain');
    const cipher = join(directory, 'cipher');
    const output = join(directory, 'restored');
    await writeFile(input, 'private customer data');
    await encryptFile(input, cipher, key);
    await expect(decryptFile(cipher, output, randomBytes(32).toString('hex'))).rejects.toThrow(/authentication failed/);
    await expect(readFile(output)).rejects.toThrow();
    const bytes = await readFile(cipher);
    bytes[25] ^= 1;
    await writeFile(cipher, bytes);
    await expect(decryptFile(cipher, output, key)).rejects.toThrow(/authentication failed/);
    await expect(readFile(output)).rejects.toThrow();
  });

  it('never overwrites an existing restore file', async () => {
    const key = randomBytes(32).toString('hex');
    const input = join(directory, 'plain');
    const cipher = join(directory, 'cipher');
    await writeFile(input, 'keep me');
    await encryptFile(input, cipher, key);
    await expect(decryptFile(cipher, input, key)).rejects.toThrow();
    expect(await readFile(input, 'utf8')).toBe('keep me');
  });

  it('rejects insecure sources and poolers and pins restore to the isolated local database', () => {
    expect(() => sourceEnvironment('postgres://u:p@db.example.com/app?sslmode=disable')).toThrow(/TLS/);
    expect(() => sourceEnvironment('postgres://u:p@ep-db-pooler.neon.tech/app')).toThrow(/direct Neon/);
    expect(sourceEnvironment('postgres://u:encoded%23password@db.example.com/app').PGPASSWORD).toBe('encoded#password');
    expect(sourceEnvironment('postgres://u:p@db.example.com/app?sslmode=require')).toMatchObject({ PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system' });
    expect(() => restoreEnvironment({})).toThrow(/isolated/);
    const target = restoreEnvironment({ BACKUP_RESTORE_ISOLATED: 'true', BACKUP_RESTORE_PASSWORD: 'test', DATABASE_URL: 'postgres://production' });
    expect(target.PGHOST).toBe('127.0.0.1');
    expect(target.PGDATABASE).toBe('uni_restore_check');
  });
});
