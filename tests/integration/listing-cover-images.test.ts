import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { listingImages } from '../../apps/api/src/db/schema';
import { createDraft, login, makeRole, setup, uploadImage, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
let seller: Awaited<ReturnType<typeof login>>;
let buyer: Awaited<ReturnType<typeof login>>;
let moderator: Awaited<ReturnType<typeof login>>;
beforeEach(async () => {
  ctx = await setup();
  seller = await login(ctx.app, 'cover-seller');
  buyer = await login(ctx.app, 'cover-buyer');
  moderator = await login(ctx.app, 'cover-moderator');
  await verifyPhone(seller);
  await verifyPhone(buyer, '9987654321');
  await makeRole(ctx.db, moderator.user.id, 'MODERATOR');
});
afterEach(async () => { await ctx?.client.close(); });

async function publish(id: string) {
  await seller.agent.post(`/api/listings/${id}/submit`).set(seller.headers).expect(200);
  await moderator.agent.post(`/api/admin/listings/${id}/decision`).set(moderator.headers).send({ decision: 'APPROVE' }).expect(200);
}

async function cards(id: string) {
  const paths = [
    [request(ctx.app), '/api/listings?q=Cover%20regression'],
    [seller.agent, '/api/my-listings'],
    [buyer.agent, '/api/favourites'],
    [buyer.agent, '/api/conversations'],
    [seller.agent, '/api/conversations'],
    [buyer.agent, '/api/transactions'],
  ] as const;
  const results = await Promise.all(paths.map(async ([agent, path]) => {
    const response = await agent.get(path).expect(200);
    const matches = response.body.data.filter((row: any) => (row.listingId ?? row.id) === id);
    expect(matches, path).toHaveLength(1);
    return { path, card: matches[0] };
  }));
  const profile = await request(ctx.app).get(`/api/sellers/${seller.user.id}`).expect(200);
  results.push({ path: '/api/sellers/:id', card: profile.body.data.activeListings.find((row: any) => row.id === id) });
  return results;
}

async function saveAndRequest(id: string) {
  await buyer.agent.post(`/api/favourites/${id}`).set(buyer.headers).expect(201);
  const response = await buyer.agent.post('/api/conversations').set(buyer.headers).send({ listingId: id }).expect(201);
  const conversationId = response.body.data.id;
  await buyer.agent.post(`/api/conversations/${conversationId}/messages`).set(buyer.headers).send({ body: 'I would like to reserve this item.', clientId: crypto.randomUUID() }).expect(201);
  await buyer.agent.post(`/api/conversations/${conversationId}/reservation-requests`).set(buyer.headers).expect(201);
}

describe('listing cover images across customer-facing APIs', () => {
  it.each(['normal', 'unfinished upload', 'failed finalization', 'deleted first photo', 'sparse positions', 'unfinalized object', 'missing object'] as const)(
    'uses the earliest usable photo after %s, through real upload and moderation', async scenario => {
      const listing = await createDraft(seller, ctx.category.id, { title: 'Cover regression item' });
      if (scenario === 'unfinished upload' || scenario === 'sparse positions') {
        await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: 100 }).expect(201);
        if (scenario === 'sparse positions') await ctx.db.update(listingImages).set({ position: 7 }).where(eq(listingImages.listingId, listing.id));
      } else if (scenario === 'failed finalization') {
        expect((await uploadImage(seller, listing.id, Buffer.from('not an image'))).status).toBe(400);
      } else if (scenario !== 'normal') {
        const first = await uploadImage(seller, listing.id);
        expect(first.status).toBe(200);
        if (scenario === 'deleted first photo') await seller.agent.delete(`/api/uploads/listings/${listing.id}/${first.body.data.id}`).set(seller.headers).expect(204);
        else await ctx.db.update(listingImages).set(scenario === 'unfinalized object' ? { finalizedAt: null } : { objectKey: null }).where(eq(listingImages.id, first.body.data.id));
      }
      const chosen = await uploadImage(seller, listing.id);
      expect(chosen.status).toBe(200);
      expect((await uploadImage(seller, listing.id)).status).toBe(200);
      const image = (await ctx.db.select().from(listingImages).where(eq(listingImages.id, chosen.body.data.id)))[0]!;
      await publish(listing.id);
      await saveAndRequest(listing.id);
      for (const { path, card } of await cards(listing.id)) {
        expect(card.coverImageUrl, path).toEqual(expect.any(String));
        const url = new URL(card.coverImageUrl);
        expect(url.searchParams.get('key'), path).toBe(image.objectKey);
        const loaded = await request(ctx.app).get(url.pathname + url.search).expect(200);
        expect(loaded.headers['content-type']).toMatch(/^image\//);
        expect(loaded.body.length).toBeGreaterThan(0);
      }
      const another = await createDraft(seller, ctx.category.id, { title: 'Cover regression other item' });
      expect((await uploadImage(seller, another.id)).status).toBe(200);
      await publish(another.id);
      const pages = await Promise.all([1, 2].map(page => request(ctx.app).get(`/api/listings?q=Cover%20regression&limit=1&page=${page}`).expect(200)));
      const rows = pages.flatMap(page => page.body.data);
      expect(rows.map(row => row.id).sort()).toEqual([listing.id, another.id].sort());
      for (const row of rows) expect(new URL(row.coverImageUrl).searchParams.get('key')).toContain(`listings/${row.id}/`);
    },
  );

  it('returns null on every surface when there are no remaining usable photos', async () => {
    const listing = await createDraft(seller, ctx.category.id, { title: 'Cover regression no photos' });
    expect((await uploadImage(seller, listing.id)).status).toBe(200);
    await publish(listing.id);
    await saveAndRequest(listing.id);
    await ctx.db.update(listingImages).set({ deletedAt: new Date() }).where(eq(listingImages.listingId, listing.id));
    for (const { path, card } of await cards(listing.id)) expect(card.coverImageUrl, path).toBeNull();
  });
});
