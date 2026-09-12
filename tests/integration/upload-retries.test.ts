import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { listingImages } from '../../apps/api/src/db/schema';
import { StorageService } from '../../apps/api/src/services/storage';
import { createDraft, login, setup, uploadImage, verifyPhone } from './helper';

describe('listing photo allocation and retries', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let seller: Awaited<ReturnType<typeof login>>;
  let listingId: string;

  beforeEach(async () => {
    ctx = await setup();
    seller = await login(ctx.app, 'upload-retry-seller');
    await verifyPhone(seller);
    listingId = (await createDraft(seller, ctx.category.id)).id;
  });
  afterEach(async () => { vi.restoreAllMocks(); await ctx?.client.close(); });

  const images = () => ctx.db.select().from(listingImages).where(eq(listingImages.listingId, listingId)).orderBy(listingImages.position);
  const presign = () => seller.agent.post(`/api/uploads/listings/${listingId}/presign`).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: 100 });

  it('allocates a presign batch atomically in request order', async () => {
    const files = [
      { mimeType: 'image/jpeg', byteSize: 101 },
      { mimeType: 'image/png', byteSize: 202 },
      { mimeType: 'image/webp', byteSize: 303 },
    ];
    const response = await seller.agent.post(`/api/uploads/listings/${listingId}/presign-batch`).set(seller.headers).send({ files }).expect(201);
    expect(response.body.data).toHaveLength(3);
    expect(new Set(response.body.data.map((ticket: { imageId: string }) => ticket.imageId)).size).toBe(3);
    const rows = await images();
    expect(rows.map(row => ({ mimeType: row.mimeType, byteSize: row.byteSize, position: row.position }))).toEqual([
      { ...files[0], position: 0 },
      { ...files[1], position: 1 },
      { ...files[2], position: 2 },
    ]);
    expect(response.body.data.map((ticket: { imageId: string }) => ticket.imageId)).toEqual(rows.map(row => row.id));
  });

  it('rejects a batch atomically when it would exceed the image limit', async () => {
    await ctx.db.insert(listingImages).values(Array.from({ length: 7 }, (_, position) => ({ listingId, ownerId: seller.user.id, position, mimeType: 'image/jpeg', byteSize: 100 })));
    const files = [{ mimeType: 'image/jpeg', byteSize: 100 }, { mimeType: 'image/jpeg', byteSize: 100 }];
    const response = await seller.agent.post(`/api/uploads/listings/${listingId}/presign-batch`).set(seller.headers).send({ files }).expect(400);
    expect(response.body.error.code).toBe('IMAGE_LIMIT_REACHED');
    expect(await images()).toHaveLength(7);
  });

  it('recovers from repeated failed finalizations on the same draft', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rejected = await uploadImage(seller, listingId, Buffer.from('not an image'));
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('INVALID_IMAGE_SIGNATURE');
    }
    expect((await uploadImage(seller, listingId)).status).toBe(200);
    const rows = await images();
    expect(rows.map(row => row.position)).toEqual([0, 1, 2, 3]);
    expect(rows.slice(0, 3).every(row => row.deletedAt && !row.finalizedAt)).toBe(true);
    expect(rows[3]).toMatchObject({ deletedAt: null, finalizedAt: expect.any(Date) });
    await seller.agent.post(`/api/listings/${listingId}/submit`).set(seller.headers).expect(200);
  });

  it.each([0, 1, 2])('replaces a removed photo at position %i without collisions or reordering retained photos', async (position) => {
    for (let i = 0; i < 3; i++) expect((await uploadImage(seller, listingId)).status).toBe(200);
    const original = await images();
    await seller.agent.delete(`/api/uploads/listings/${listingId}/${original[position]!.id}`).set(seller.headers).expect(204);
    expect((await uploadImage(seller, listingId)).status).toBe(200);
    const rows = await images();
    expect(rows.map(row => row.position)).toEqual([0, 1, 2, 3]);
    expect(rows[position]!.deletedAt).not.toBeNull();
    expect(rows.filter(row => !row.deletedAt).slice(0, 2).map(row => row.id)).toEqual(original.filter(row => row.position !== position).map(row => row.id));
    const page = await seller.agent.get(`/api/listings/${listingId}`).expect(200);
    expect(page.body.data.images.map((image: { id: string }) => image.id)).toEqual(rows.filter(row => !row.deletedAt).map(row => row.id));
  });

  it('counts only active photos toward the limit but never reuses historical positions', async () => {
    await ctx.db.insert(listingImages).values(Array.from({ length: 10 }, (_, position) => ({ listingId, ownerId: seller.user.id, position, mimeType: 'image/jpeg', byteSize: 100, deletedAt: new Date() })));
    for (let i = 0; i < ctx.config.MAX_LISTING_IMAGES; i++) await presign().expect(201);
    const full = await presign().expect(400);
    expect(full.body.error.code).toBe('IMAGE_LIMIT_REACHED');
    expect((await images()).filter(row => !row.deletedAt).map(row => row.position)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('does not confuse sparse photo positions with the active photo count', async () => {
    await ctx.db.insert(listingImages).values([0, 2, 7].map(position => ({ listingId, ownerId: seller.user.id, position, mimeType: 'image/jpeg', byteSize: 100 })));
    await presign().expect(201);
    expect((await images()).map(row => row.position)).toEqual([0, 2, 7, 8]);
  });

  it('does not consume a slot when signing fails and allows the next attempt', async () => {
    vi.spyOn(StorageService.prototype, 'createUploadTicket').mockRejectedValueOnce(new Error('Simulated signing failure'));
    await presign().expect(500);
    expect(await images()).toHaveLength(0);
    await presign().expect(201);
    expect((await images()).map(row => row.position)).toEqual([0]);
  });

  it('does not allocate positions for invalid or oversized requests', async () => {
    const url = `/api/uploads/listings/${listingId}/presign`;
    await seller.agent.post(url).set(seller.headers).send({ mimeType: 'image/svg+xml', byteSize: 100 }).expect(400);
    await seller.agent.post(url).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: 0 }).expect(400);
    await seller.agent.post(url).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: 6 * 1024 * 1024 }).expect(413);
    expect(await images()).toHaveLength(0);
    await presign().expect(201);
    expect((await images())[0]!.position).toBe(0);
  });

  it('preserves authentication, CSRF and ownership checks without reserving slots', async () => {
    const url = `/api/uploads/listings/${listingId}/presign`;
    const input = { mimeType: 'image/jpeg', byteSize: 100 };
    await request(ctx.app).post(url).send(input).expect(401);
    await seller.agent.post(url).send(input).expect(403);
    const other = await login(ctx.app, 'upload-other-owner');
    await verifyPhone(other, '9987654321');
    const denied = await other.agent.post(url).set(other.headers).send(input).expect(404);
    expect(denied.body.error.code).toBe('LISTING_NOT_FOUND');
    const batchUrl = `/api/uploads/listings/${listingId}/presign-batch`;
    const batchInput = { files: [input] };
    await request(ctx.app).post(batchUrl).send(batchInput).expect(401);
    await seller.agent.post(batchUrl).send(batchInput).expect(403);
    const batchDenied = await other.agent.post(batchUrl).set(other.headers).send(batchInput).expect(404);
    expect(batchDenied.body.error.code).toBe('LISTING_NOT_FOUND');
    expect(await images()).toHaveLength(0);
  });
});
