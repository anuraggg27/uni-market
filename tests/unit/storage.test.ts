import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../apps/api/src/config';
import { StorageService } from '../../apps/api/src/services/storage';

describe('R2 upload signing', () => {
  it('signs ownership metadata as required browser headers', async () => {
    const storage = new StorageService(loadConfig({
      NODE_ENV: 'development',
      DEV_MODE: 'true',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
      R2_BUCKET_NAME: 'uni-market-staging',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    }));

    const ticket = await storage.createUploadTicket('owner-id', 'listing-id', 'image/jpeg', 1024);
    const url = new URL(ticket.uploadUrl);
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];

    expect(ticket.headers).toEqual({
      'content-type': 'image/jpeg',
      'x-amz-meta-owner': 'owner-id',
      'x-amz-meta-listing': 'listing-id',
    });
    expect(signedHeaders).toEqual(expect.arrayContaining([
      'x-amz-meta-owner',
      'x-amz-meta-listing',
    ]));
    expect(url.searchParams.has('x-amz-meta-owner')).toBe(false);
    expect(url.searchParams.has('x-amz-meta-listing')).toBe(false);
  });

  it('finalizes with GET metadata validation and no separate HEAD request', async () => {
    const storage = new StorageService(loadConfig({
      NODE_ENV: 'development',
      DEV_MODE: 'true',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
      R2_BUCKET_NAME: 'uni-market-staging',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    }));
    const source = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#56806a' } }).jpeg().toBuffer();
    const commandNames: string[] = [];
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      commandNames.push(command.constructor.name);
      if (command.constructor.name === 'GetObjectCommand') {
        return {
          ContentLength: source.length,
          Metadata: { owner: 'owner-id', listing: 'listing-id' },
          Body: { transformToByteArray: async () => source },
        };
      }
      return {};
    });
    (storage as unknown as { s3: { send: typeof send } }).s3 = { send };

    const result = await storage.finalize('temporary/owner-id/listing-id/source', 'owner-id', 'listing-id', source.length);

    expect(result).toMatchObject({ mimeType: 'image/webp', width: 32, height: 24 });
    expect(commandNames[0]).toBe('GetObjectCommand');
    expect(commandNames.slice(1).sort()).toEqual(['DeleteObjectCommand', 'PutObjectCommand']);
    expect(commandNames).not.toContain('HeadObjectCommand');
  });
});
