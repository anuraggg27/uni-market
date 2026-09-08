import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { createDraft, login, setup, uploadImage, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
let seller: Awaited<ReturnType<typeof login>>;

beforeEach(async () => {
  ctx = await setup();
  seller = await login(ctx.app, 'seller-cover');
  await verifyPhone(seller);
});
afterEach(async () => { await ctx?.client.close(); });

async function activeListing(title = 'Used book') {
  const listing = await createDraft(seller, ctx.category.id, { title });
  await uploadImage(seller, listing.id).then(response => expect(response.status).toBe(200));
  await ctx.db.update(schema.listings).set({ moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date() }).where(eq(schema.listings.id, listing.id));
  return listing;
}

async function profile() {
  return request(ctx.app).get(`/api/sellers/${seller.user.id}`).expect(200);
}

describe('seller profile cover images', () => {
  it('returns a loadable signed photo URL to a guest without exposing storage keys', async () => {
    const listing = await activeListing('Ikigai');
    const response = await profile();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.activeListings).toHaveLength(1);
    const card = response.body.data.activeListings[0];
    expect(card).toMatchObject({ id: listing.id, title: 'Ikigai', coverImageUrl: expect.any(String) });
    expect(card).not.toHaveProperty('objectKey');
    const url = new URL(card.coverImageUrl);
    const image = await request(ctx.app).get(`${url.pathname}${url.search}`).expect(200);
    expect(image.headers['content-type']).toMatch(/^image\//);
    expect(image.body.length).toBeGreaterThan(0);
  });

  it('selects the first remaining finalized photo when position zero was deleted', async () => {
    const listing = await activeListing();
    await ctx.db.update(schema.listingImages).set({ deletedAt: new Date() }).where(eq(schema.listingImages.listingId, listing.id));
    await uploadImage(seller, listing.id).then(response => expect(response.status).toBe(200));
    await uploadImage(seller, listing.id).then(response => expect(response.status).toBe(200));
    // Replacing photos sends a live listing back to moderation. These photos
    // must be approved before the listing is public again.
    await ctx.db.update(schema.listings).set({ moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date() }).where(eq(schema.listings.id, listing.id));
    const images = await ctx.db.select().from(schema.listingImages).where(eq(schema.listingImages.listingId, listing.id));
    const firstRemaining = images.find(image => image.position === 1)!;
    const response = await profile();
    expect(response.body.data.activeListings).toHaveLength(1);
    const url = new URL(response.body.data.activeListings[0].coverImageUrl);
    expect(url.searchParams.get('key')).toBe(firstRemaining.objectKey);
    await request(ctx.app).get(`${url.pathname}${url.search}`).expect(200);
  });

  it.each([
    { deletedAt: new Date() },
    { finalizedAt: null },
    { objectKey: null },
    { syntheticStatus: 'SYNTHETIC_OR_MATERIALLY_ALTERED' },
    { syntheticStatus: 'UNKNOWN' },
  ])('returns null instead of signing an ineligible image: %j', async overrides => {
    const listing = await activeListing();
    await ctx.db.update(schema.listingImages).set(overrides).where(eq(schema.listingImages.listingId, listing.id));
    const response = await profile();
    expect(response.body.data.activeListings[0].coverImageUrl).toBeNull();
  });

  it('maps photos to the correct active listing and excludes private or deleted listings', async () => {
    const first = await activeListing('First book');
    const second = await activeListing('Second book');
    const removed = await activeListing('Removed book');
    await ctx.db.update(schema.listings).set({ deletedAt: new Date() }).where(eq(schema.listings.id, removed.id));
    await createDraft(seller, ctx.category.id, { title: 'Private book' });
    const response = await profile();
    const cards = response.body.data.activeListings;
    expect(cards.map((card: { id: string }) => card.id).sort()).toEqual([first.id, second.id].sort());
    for (const card of cards) {
      expect(new URL(card.coverImageUrl).searchParams.get('key')).toMatch(new RegExp(`^listings/${card.id}/`));
    }
  });

  it('returns an empty listing collection for a seller with no listings', async () => {
    expect((await profile()).body.data.activeListings).toEqual([]);
  });
});
