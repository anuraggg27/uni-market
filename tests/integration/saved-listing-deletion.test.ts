import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { login, makeRole, setup } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
let seller: Awaited<ReturnType<typeof login>>;
let buyer: Awaited<ReturnType<typeof login>>;
let secondBuyer: Awaited<ReturnType<typeof login>>;

beforeEach(async () => {
  ctx = await setup();
  seller = await login(ctx.app, 'saved-owner');
  buyer = await login(ctx.app, 'saved-buyer-one');
  secondBuyer = await login(ctx.app, 'saved-buyer-two');
});
afterEach(async () => { await ctx?.client.close(); });

async function listing() {
  return (await ctx.db.insert(schema.listings).values({
    sellerId: seller.user.id, categoryId: ctx.category.id, title: 'Saved textbook',
    description: 'A physical textbook for the saved-item deletion regression.',
    condition: 'GOOD', priceType: 'FREE', location: 'Campus',
    moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date(),
  }).returning())[0]!;
}

describe('saved listings after removal', () => {
  it.each(['seller', 'admin'] as const)('clears every saved reference on %s deletion without affecting other listings', async actor => {
    const removed = await listing();
    const retained = await listing();
    for (const user of [buyer, secondBuyer]) {
      await user.agent.post(`/api/favourites/${removed.id}`).set(user.headers).expect(201);
      await user.agent.post(`/api/favourites/${retained.id}`).set(user.headers).expect(201);
    }
    if (actor === 'admin') {
      const moderator = await login(ctx.app, 'saved-moderator');
      await makeRole(ctx.db, moderator.user.id, 'MODERATOR');
      await moderator.agent.delete(`/api/admin/listings/${removed.id}`).set(moderator.headers).expect(204);
      const audit = await ctx.db.select().from(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.targetId, removed.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe('LISTING_DELETE');
    } else await seller.agent.delete(`/api/listings/${removed.id}`).set(seller.headers).expect(204);
    expect(await ctx.db.select().from(schema.favourites).where(eq(schema.favourites.listingId, removed.id))).toHaveLength(0);
    const row = (await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, removed.id)))[0]!;
    expect(row.deletedAt).toBeTruthy();
    expect(row.favouriteCount).toBe(0);
    expect(await ctx.db.select().from(schema.favourites).where(eq(schema.favourites.listingId, retained.id))).toHaveLength(2);
    expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, retained.id)))[0]?.favouriteCount).toBe(2);
    for (const user of [buyer, secondBuyer]) {
      const response = await user.agent.get('/api/favourites').expect(200);
      expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([retained.id]);
      await user.agent.post(`/api/favourites/${removed.id}`).set(user.headers).expect(404);
    }
  });

  it.each([
    { deletedAt: new Date() },
    { moderationState: 'REMOVED' as const },
    { moderationState: 'PENDING' as const, lifecycleState: 'DRAFT' as const },
    { lifecycleState: 'WITHDRAWN' as const },
  ])('hides legacy saved entries that are no longer public: %j', async change => {
    const item = await listing();
    await buyer.agent.post(`/api/favourites/${item.id}`).set(buyer.headers).expect(201);
    await ctx.db.update(schema.listings).set(change).where(eq(schema.listings.id, item.id));
    expect((await buyer.agent.get('/api/favourites').expect(200)).body.data).toEqual([]);
    // The read endpoint must hide legacy residue without mutating customer data.
    expect(await ctx.db.select().from(schema.favourites)).toHaveLength(1);
  });

  it.each(['ACTIVE', 'RESERVED', 'SOLD'] as const)('keeps an approved %s listing in Saved', async lifecycleState => {
    const item = await listing();
    await ctx.db.update(schema.listings).set({ lifecycleState }).where(eq(schema.listings.id, item.id));
    await buyer.agent.post(`/api/favourites/${item.id}`).set(buyer.headers).expect(201);
    expect((await buyer.agent.get('/api/favourites').expect(200)).body.data[0]?.id).toBe(item.id);
  });

  it('does not erase saves when someone other than the owner attempts deletion', async () => {
    const item = await listing();
    await buyer.agent.post(`/api/favourites/${item.id}`).set(buyer.headers).expect(201);
    await secondBuyer.agent.delete(`/api/listings/${item.id}`).set(secondBuyer.headers).expect(404);
    expect(await ctx.db.select().from(schema.favourites)).toHaveLength(1);
    expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, item.id)))[0]?.deletedAt).toBeNull();
  });

  it('does not leave a saved row when saving races with deletion', async () => {
    const item = await listing();
    const [save, remove] = await Promise.all([
      buyer.agent.post(`/api/favourites/${item.id}`).set(buyer.headers),
      seller.agent.delete(`/api/listings/${item.id}`).set(seller.headers),
    ]);
    expect([201, 404]).toContain(save.status);
    expect(remove.status).toBe(204);
    expect(await ctx.db.select().from(schema.favourites)).toHaveLength(0);
    expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, item.id)))[0]?.favouriteCount).toBe(0);
  });
});
