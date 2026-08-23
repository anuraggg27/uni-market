import { describe, expect, it } from 'vitest';
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
});
