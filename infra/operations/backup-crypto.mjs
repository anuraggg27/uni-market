import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('UNIBAK01');

function keyBytes(key) {
  if (!/^[a-fA-F0-9]{64}$/.test(key ?? '')) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters');
  return Buffer.from(key, 'hex');
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function encryptFile(input, output, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(magic);
  const handle = await open(output, 'wx', 0o600);
  try { await handle.write(Buffer.concat([magic, iv])); }
  finally { await handle.close(); }
  try {
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: 'a', mode: 0o600 }));
    await appendFile(output, cipher.getAuthTag());
  } catch (error) { await unlink(output); throw error; }
}

export async function decryptFile(input, output, key) {
  const bytes = keyBytes(key);
  const size = (await stat(input)).size;
  if (size < magic.length + 12 + 16) throw new Error('Truncated encrypted backup');
  const handle = await open(input, 'r');
  const header = Buffer.alloc(magic.length + 12);
  const tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, size - tag.length);
  } finally { await handle.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv('aes-256-gcm', bytes, header.subarray(magic.length));
  decipher.setAAD(magic);
  decipher.setAuthTag(tag);
  // Claim the destination first so failure cleanup can never remove a pre-existing file.
  const destination = await open(output, 'wx', 0o600);
  await destination.close();
  try {
    if (size === header.length + tag.length) decipher.final();
    else await pipeline(createReadStream(input, { start: header.length, end: size - tag.length - 1 }), decipher, createWriteStream(output, { flags: 'r+', mode: 0o600 }));
  } catch {
    await unlink(output);
    throw new Error('Backup authentication failed; no restore was attempted');
  }
}
