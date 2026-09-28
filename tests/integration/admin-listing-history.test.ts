import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { adminAuditLogs, listings, moderationNotes, notifications, transactions } from '../../apps/api/src/db/schema';
import { login, makeRole, setup, verifyMarketplaceEligibility } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
let mod: Awaited<ReturnType<typeof login>>;
beforeEach(async () => {
  ctx = await setup();
  mod = await login(ctx.app, 'listing-history-admin');
  await makeRole(ctx.db, mod.user.id, 'MODERATOR');
});
afterEach(async () => ctx?.client.close());

async function seed(patch: Partial<typeof listings.$inferInsert> = {}) {
  return (await ctx.db.insert(listings).values({
    sellerId: mod.user.id, categoryId: ctx.category.id, title: 'History listing',
    description: 'An item retained for moderation review.', condition: 'GOOD',
    priceType: 'FREE', location: 'Campus', ...patch,
  }).returning())[0]!;
}

async function ids(query = '') {
  const response = await mod.agent.get('/api/admin/listings' + query).expect(200);
  return response.body.data.rows.map((row: any) => row.listing.id);
}

describe('admin listing history', () => {
  it('filters every moderation outcome separately and keeps the pending queue restricted', async () => {
    const draft = await seed();
    const pending = await seed({ submittedAt: new Date() });
    const changes = await seed({ moderationState: 'REJECTED', requestedChanges: 'Replace the photo', rejectionReason: 'Replace the photo' });
    const rejected = await seed({ moderationState: 'REJECTED', rejectionReason: 'Prohibited item' });
    const removed = await seed({ moderationState: 'REMOVED', rejectionReason: 'Removed after a report' });
    const sold = await seed({ moderationState: 'APPROVED', lifecycleState: 'SOLD' });
    await seed({ moderationState: 'REMOVED', deletedAt: new Date() });
    expect(await ids()).toHaveLength(6);
    for (const [status, listing] of [['DRAFT', draft], ['PENDING', pending], ['CHANGES_REQUESTED', changes], ['REJECTED', rejected], ['REMOVED', removed], ['APPROVED', sold]] as const) {
      expect(await ids('?status=' + status)).toEqual([listing.id]);
    }
    expect(await ids('?status=APPROVED&lifecycle=SOLD&category=' + ctx.category.id + '&seller=' + mod.user.id)).toEqual([sold.id]);
    expect(await ids('?status=REMOVED&lifecycle=SOLD')).toEqual([]);
    const queue = await mod.agent.get('/api/admin/listings/pending?status=ALL').expect(200);
    expect(queue.body.data.map((row: any) => row.listing.id)).toEqual([pending.id]);
    await mod.agent.get('/api/admin/listings/' + removed.id).expect(200);
    await mod.agent.get('/api/listings/' + removed.id).expect(200);
    await request(ctx.app).get('/api/listings/' + removed.id).expect(404);
  });

  it('requires moderator access and rejects invalid filters', async () => {
    await request(ctx.app).get('/api/admin/listings').expect(401);
    const ordinary = await login(ctx.app, 'listing-history-user');
    await ordinary.agent.get('/api/admin/listings').expect(403);
    await makeRole(ctx.db, ordinary.user.id, 'SUPPORT_AGENT');
    await ordinary.agent.get('/api/admin/listings').expect(403);
    await mod.agent.get('/api/admin/listings?status=INVALID').expect(400);
    await mod.agent.get('/api/admin/listings?page=0').expect(400);
  });

  it('clears requested changes when a later decision rejects or removes the listing', async () => {
    const listing = await seed({ submittedAt: new Date() });
    for (const finalDecision of ['REJECT', 'REMOVE']) {
      await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send({ decision: 'REQUEST_CHANGES', internalReason: 'Photo needs replacement', userVisibleReason: 'Please replace the photo' }).expect(200);
      expect(await ids('?status=CHANGES_REQUESTED')).toEqual([listing.id]);
      await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send({ decision: finalDecision, internalReason: 'Prohibited goods confirmed', userVisibleReason: 'This item is prohibited' }).expect(200);
      expect(await ids('?status=CHANGES_REQUESTED')).toEqual([]);
      expect((await ctx.db.select().from(listings).where(eq(listings.id, listing.id)))[0]?.requestedChanges).toBeNull();
    }
  });

  it('preserves a reservation when a moderator requests changes, then allows review after cancellation', async () => {
    const buyer = await login(ctx.app, 'listing-history-buyer');
    await verifyMarketplaceEligibility(buyer);
    const listing = await seed({
      submittedAt: new Date(), approvedAt: new Date(), moderationState: 'APPROVED',
      lifecycleState: 'RESERVED', reservedBuyerId: buyer.user.id,
    });
    const transaction = (await ctx.db.insert(transactions).values({
      listingId: listing.id, buyerId: buyer.user.id, sellerId: mod.user.id, status: 'RESERVED',
    }).returning())[0]!;
    const before = {
      notifications: (await ctx.db.select().from(notifications)).length,
      notes: (await ctx.db.select().from(moderationNotes)).length,
      audits: (await ctx.db.select().from(adminAuditLogs)).length,
    };
    const decision = { decision: 'REQUEST_CHANGES', internalReason: 'Replace the photo', userVisibleReason: 'Please replace the photo', note: 'Bad photo' };

    const rejected = await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send(decision).expect(409);
    expect(rejected.body.error.code).toBe('LISTING_LOCKED');
    expect((await ctx.db.select().from(listings).where(eq(listings.id, listing.id)))[0]).toMatchObject({
      moderationState: 'APPROVED', lifecycleState: 'RESERVED', reservedBuyerId: buyer.user.id,
    });
    expect((await ctx.db.select().from(transactions).where(eq(transactions.id, transaction.id)))[0]?.status).toBe('RESERVED');
    expect((await ctx.db.select().from(notifications)).length).toBe(before.notifications);
    expect((await ctx.db.select().from(moderationNotes)).length).toBe(before.notes);
    expect((await ctx.db.select().from(adminAuditLogs)).length).toBe(before.audits);

    await buyer.agent.post(`/api/transactions/${transaction.id}/cancel`).set(buyer.headers).expect(200);
    await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send(decision).expect(200);
    expect((await ctx.db.select().from(listings).where(eq(listings.id, listing.id)))[0]).toMatchObject({
      moderationState: 'REJECTED', lifecycleState: 'DRAFT', reservedBuyerId: null,
      requestedChanges: 'Please replace the photo',
    });
    expect((await ctx.db.select().from(transactions).where(eq(transactions.id, transaction.id)))[0]?.status).toBe('CANCELLED_BY_BUYER');
  });

  it('paginates deterministically without dropping or repeating rows with identical timestamps', async () => {
    const first = await seed();
    const template = { ...first, id: undefined };
    await ctx.db.insert(listings).values(Array.from({ length: 50 }, (_, index) => ({ ...template, title: 'Listing ' + index })));
    const pageOne = await mod.agent.get('/api/admin/listings?sort=oldest').expect(200);
    const pageTwo = await mod.agent.get('/api/admin/listings?sort=oldest&page=2').expect(200);
    expect(pageOne.body.data).toMatchObject({ total: 51, page: 1, pageSize: 50 });
    expect(pageOne.body.data.rows).toHaveLength(50);
    expect(pageTwo.body.data.rows).toHaveLength(1);
    expect(new Set([...pageOne.body.data.rows, ...pageTwo.body.data.rows].map((row: any) => row.listing.id)).size).toBe(51);
  });
});
