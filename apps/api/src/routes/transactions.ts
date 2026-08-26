import { Router } from 'express';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { idSchema, reviewSchema } from '@campus-market/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { listings, notifications, reviews, transactions, users } from '../db/schema.js';
import { requireVerified } from '../middleware/auth.js';
import { keyedHash, safeEqual } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';

type TransactionRow = typeof transactions.$inferSelect;

const exchangeCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit exchange code') });

function deriveExchangeCode(transaction: Pick<TransactionRow, 'id' | 'buyerId' | 'exchangeCodeVersion'>, secret: string): string {
  const digest = keyedHash(`exchange-code:${transaction.id}:${transaction.buyerId}:v${transaction.exchangeCodeVersion}`, secret);
  return (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000n).toString().padStart(6, '0');
}

function publicTransaction(transaction: TransactionRow, userId: string, config: AppConfig, listingTitle?: string) {
  const role = transaction.buyerId === userId ? 'BUYER' : 'SELLER';
  return {
    id: transaction.id,
    listingId: transaction.listingId,
    buyerId: transaction.buyerId,
    sellerId: transaction.sellerId,
    status: transaction.status,
    completedAt: transaction.completedAt,
    cancelledAt: transaction.cancelledAt,
    disputeReason: transaction.disputeReason,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    ...(listingTitle === undefined ? {} : { listingTitle }),
    role,
    ...(transaction.status === 'RESERVED' ? { exchangeCodeLocked: Boolean(transaction.exchangeCodeLockedAt) } : {}),
    ...(role === 'BUYER' && transaction.status === 'RESERVED' ? { exchangeCode: deriveExchangeCode(transaction, config.SESSION_SECRET) } : {}),
  };
}

export function transactionsRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.get('/transactions', requireVerified, asyncRoute(async (req, res) => {
    const rows = await db.select({ transaction: transactions, listingTitle: listings.title }).from(transactions).innerJoin(listings, eq(listings.id, transactions.listingId)).where(or(eq(transactions.buyerId, req.auth!.userId), eq(transactions.sellerId, req.auth!.userId))).orderBy(desc(transactions.updatedAt));
    res.json({ data: rows.map((row) => publicTransaction(row.transaction, req.auth!.userId, config, row.listingTitle)) });
  }));

  router.post('/transactions', requireVerified, asyncRoute(async (req, res) => {
    const { listingId } = z.object({ listingId: idSchema }).parse(req.body);
    const listing = (await db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.moderationState, 'APPROVED'), eq(listings.lifecycleState, 'ACTIVE'), isNull(listings.deletedAt))).limit(1))[0];
    if (!listing) throw new AppError(409, 'LISTING_NOT_AVAILABLE', 'This listing is not available for purchase');
    if (listing.sellerId === req.auth!.userId) throw new AppError(400, 'SELF_PURCHASE', 'You cannot buy your own listing');
    const existing = (await db.select().from(transactions).where(and(eq(transactions.listingId, listingId), eq(transactions.buyerId, req.auth!.userId), inArray(transactions.status, ['REQUESTED', 'ACCEPTED', 'RESERVED', 'HANDED_OVER']))).limit(1))[0];
    if (existing) { res.json({ data: publicTransaction(existing, req.auth!.userId, config) }); return; }
    const transaction = (await db.insert(transactions).values({ listingId, buyerId: req.auth!.userId, sellerId: listing.sellerId }).returning())[0]!;
    await db.insert(notifications).values({ userId: listing.sellerId, type: 'PURCHASE_REQUEST', title: 'Purchase request', body: 'A buyer requested to purchase your listing', href: '/transactions' });
    res.status(201).json({ data: publicTransaction(transaction, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/accept', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const result = await db.transaction(async (tx) => {
      const transaction = (await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.sellerId, req.auth!.userId))).limit(1))[0];
      if (!transaction || transaction.status !== 'REQUESTED') throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This request cannot be accepted');
      const reserved = (await tx.update(listings).set({ lifecycleState: 'RESERVED', reservedBuyerId: transaction.buyerId, updatedAt: new Date() }).where(and(eq(listings.id, transaction.listingId), eq(listings.lifecycleState, 'ACTIVE'), eq(listings.moderationState, 'APPROVED'))).returning())[0];
      if (!reserved) throw new AppError(409, 'ALREADY_RESERVED', 'Another request already reserved this listing');
      const now = new Date();
      const updated = (await tx.update(transactions).set({ status: 'RESERVED', exchangeCodeAttempts: 0, exchangeCodeIssuedAt: now, exchangeCodeLockedAt: null, exchangeCodeUsedAt: null, updatedAt: now }).where(and(eq(transactions.id, id), eq(transactions.status, 'REQUESTED'))).returning())[0]!;
      await tx.insert(notifications).values([{ userId: transaction.buyerId, type: 'REQUEST_ACCEPTED', title: 'Request accepted', body: 'The seller accepted your request. Your exchange code is ready in Transactions.', href: '/transactions' }, { userId: transaction.buyerId, type: 'LISTING_RESERVED', title: 'Listing reserved', body: 'This listing is now reserved for you', href: `/listing/${transaction.listingId}` }]);
      return updated;
    });
    res.json({ data: publicTransaction(result, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/handover', requireVerified, asyncRoute(async (req) => {
    const id = idSchema.parse(req.params.id);
    const transaction = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!transaction || transaction.sellerId !== req.auth!.userId) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot update this transaction');
    if (transaction.status !== 'RESERVED') throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction is not awaiting exchange');
    throw new AppError(409, 'EXCHANGE_CODE_REQUIRED', 'Enter the buyer\'s exchange code to complete this sale');
  }));

  router.post('/transactions/:id/exchange/complete', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { code } = exchangeCodeSchema.parse(req.body);
    const existing = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!existing || existing.sellerId !== req.auth!.userId) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot update this transaction');
    if (existing.status === 'COMPLETED') { res.json({ data: publicTransaction(existing, req.auth!.userId, config) }); return; }
    if (existing.status !== 'RESERVED') throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction is not awaiting exchange');
    if (existing.exchangeCodeLockedAt) throw new AppError(429, 'EXCHANGE_CODE_LOCKED', 'Ask the buyer to generate a new exchange code');

    const expectedCode = deriveExchangeCode(existing, config.SESSION_SECRET);
    if (!safeEqual(code, expectedCode)) {
      const changed = (await db.update(transactions).set({
        exchangeCodeAttempts: sql`least(${transactions.exchangeCodeAttempts} + 1, 5)`,
        exchangeCodeLockedAt: sql`case when ${transactions.exchangeCodeAttempts} + 1 >= 5 then now() else ${transactions.exchangeCodeLockedAt} end`,
        updatedAt: new Date(),
      }).where(and(eq(transactions.id, id), eq(transactions.sellerId, req.auth!.userId), eq(transactions.status, 'RESERVED'), eq(transactions.exchangeCodeVersion, existing.exchangeCodeVersion), isNull(transactions.exchangeCodeLockedAt))).returning())[0];
      if (changed?.exchangeCodeLockedAt) throw new AppError(429, 'EXCHANGE_CODE_LOCKED', 'Ask the buyer to generate a new exchange code');
      throw new AppError(400, 'EXCHANGE_CODE_INVALID', 'The exchange code could not be accepted');
    }

    const completed = await db.transaction(async (tx) => {
      const now = new Date();
      const updated = (await tx.update(transactions).set({ status: 'COMPLETED', completedAt: now, exchangeCodeUsedAt: now, updatedAt: now }).where(and(eq(transactions.id, id), eq(transactions.sellerId, req.auth!.userId), eq(transactions.status, 'RESERVED'), eq(transactions.exchangeCodeVersion, existing.exchangeCodeVersion), isNull(transactions.exchangeCodeLockedAt))).returning())[0];
      if (!updated) throw new AppError(409, 'EXCHANGE_CODE_CHANGED', 'Ask the buyer for their current exchange code');
      const sold = (await tx.update(listings).set({ lifecycleState: 'SOLD', soldAt: now, updatedAt: now }).where(and(eq(listings.id, updated.listingId), eq(listings.lifecycleState, 'RESERVED'), eq(listings.reservedBuyerId, updated.buyerId))).returning({ id: listings.id }))[0];
      if (!sold) throw new AppError(409, 'LISTING_STATE_CHANGED', 'This listing can no longer be completed');
      await tx.update(users).set({ completedSales: sql`${users.completedSales} + 1`, updatedAt: now }).where(eq(users.id, updated.sellerId));
      await tx.insert(notifications).values([
        { userId: updated.buyerId, type: 'TRANSACTION_COMPLETED', title: 'Exchange complete', body: 'Your exchange was completed. You can now leave a review.', href: '/transactions' },
        { userId: updated.sellerId, type: 'TRANSACTION_COMPLETED', title: 'Sale complete', body: 'The exchange code was accepted and your sale was completed.', href: '/transactions' },
      ]);
      return updated;
    });
    res.json({ data: publicTransaction(completed, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/exchange-code/rotate', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const existing = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!existing || existing.buyerId !== req.auth!.userId) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot update this transaction');
    if (existing.status !== 'RESERVED') throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction does not have an active exchange code');
    const updated = (await db.update(transactions).set({ exchangeCodeVersion: sql`${transactions.exchangeCodeVersion} + 1`, exchangeCodeAttempts: 0, exchangeCodeIssuedAt: new Date(), exchangeCodeLockedAt: null, updatedAt: new Date() }).where(and(eq(transactions.id, id), eq(transactions.buyerId, req.auth!.userId), eq(transactions.status, 'RESERVED'))).returning())[0];
    if (!updated) throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction was already updated');
    res.json({ data: publicTransaction(updated, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/complete', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const existing = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!existing || existing.buyerId !== req.auth!.userId) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot update this transaction');
    if (existing.status === 'COMPLETED') { res.json({ data: publicTransaction(existing, req.auth!.userId, config) }); return; }
    if (existing.status !== 'HANDED_OVER') throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'Confirm receipt only after the seller records handover');
    const completed = await db.transaction(async (tx) => {
      const updated = (await tx.update(transactions).set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() }).where(and(eq(transactions.id, id), eq(transactions.status, 'HANDED_OVER'))).returning())[0];
      if (!updated) throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction was already updated');
      const sold = (await tx.update(listings).set({ lifecycleState: 'SOLD', soldAt: new Date(), updatedAt: new Date() }).where(and(eq(listings.id, updated.listingId), eq(listings.lifecycleState, 'RESERVED'), eq(listings.reservedBuyerId, updated.buyerId))).returning({ id: listings.id }))[0];
      if (!sold) throw new AppError(409, 'LISTING_STATE_CHANGED', 'This listing can no longer be completed');
      await tx.update(users).set({ completedSales: sql`${users.completedSales} + 1`, updatedAt: new Date() }).where(eq(users.id, updated.sellerId));
      await tx.insert(notifications).values({ userId: updated.sellerId, type: 'TRANSACTION_COMPLETED', title: 'Transaction complete', body: 'The buyer confirmed receipt', href: '/transactions' });
      return updated;
    });
    res.json({ data: publicTransaction(completed, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/cancel', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const transaction = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!transaction || ![transaction.buyerId, transaction.sellerId].includes(req.auth!.userId)) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot cancel this transaction');
    if (!['REQUESTED', 'ACCEPTED', 'RESERVED'].includes(transaction.status)) throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction can no longer be cancelled');
    const status = req.auth!.userId === transaction.buyerId ? 'CANCELLED_BY_BUYER' : 'CANCELLED_BY_SELLER';
    const updated = await db.transaction(async (tx) => {
      const changed = (await tx.update(transactions).set({ status, cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(transactions.id, id), inArray(transactions.status, ['REQUESTED', 'ACCEPTED', 'RESERVED']))).returning())[0]!;
      if (transaction.status === 'RESERVED') await tx.update(listings).set({ lifecycleState: 'ACTIVE', reservedBuyerId: null, updatedAt: new Date() }).where(and(eq(listings.id, transaction.listingId), eq(listings.reservedBuyerId, transaction.buyerId)));
      return changed;
    });
    res.json({ data: publicTransaction(updated, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/reviews', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id); const input = reviewSchema.parse(req.body);
    const transaction = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!transaction || transaction.status !== 'COMPLETED') throw new AppError(409, 'REVIEW_NOT_ELIGIBLE', 'Reviews are available after a completed transaction');
    if (![transaction.buyerId, transaction.sellerId].includes(req.auth!.userId)) throw new AppError(403, 'REVIEW_FORBIDDEN', 'Only transaction participants can review');
    const revieweeId = req.auth!.userId === transaction.buyerId ? transaction.sellerId : transaction.buyerId;
    if (revieweeId === req.auth!.userId) throw new AppError(400, 'SELF_REVIEW', 'You cannot review yourself');
    try {
      const review = (await db.insert(reviews).values({ transactionId: id, reviewerId: req.auth!.userId, revieweeId, rating: input.rating, text: input.text, tags: input.tags }).returning())[0]!;
      await db.insert(notifications).values({ userId: revieweeId, type: 'REVIEW_RECEIVED', title: 'New review', body: 'You received a verified transaction review', href: `/seller/${revieweeId}` });
      res.status(201).json({ data: { ...review, verifiedTransaction: true } });
    } catch (error: any) {
      if (error?.code === '23505' || String(error?.message).includes('review_once_idx') || String(error?.cause?.message).includes('review_once_idx')) throw new AppError(409, 'DUPLICATE_REVIEW', 'You already reviewed this transaction');
      throw error;
    }
  }));

  return router;
}

export function reputationRouter(db: Database): Router {
  const router = Router();
  router.get('/sellers/:id', asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const seller = (await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, institution: users.institution, campus: users.campus, phoneVerifiedAt: users.phoneVerifiedAt, completedSales: users.completedSales, createdAt: users.createdAt }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt), isNull(users.suspendedAt))).limit(1))[0];
    if (!seller) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller profile not found');
    const [rating, activeListings, recentReviews] = await Promise.all([
      db.select({ average: sql<number>`coalesce(avg(${reviews.rating}), 0)`, count: sql<number>`count(*)` }).from(reviews).where(and(eq(reviews.revieweeId, id), isNull(reviews.hiddenAt), isNull(reviews.deletedAt))),
      db.select().from(listings).where(and(eq(listings.sellerId, id), eq(listings.moderationState, 'APPROVED'), eq(listings.lifecycleState, 'ACTIVE'), isNull(listings.deletedAt))).orderBy(desc(listings.approvedAt)).limit(20),
      db.select({ id: reviews.id, rating: reviews.rating, text: reviews.text, tags: reviews.tags, createdAt: reviews.createdAt, reviewerName: users.displayName }).from(reviews).innerJoin(users, eq(users.id, reviews.reviewerId)).where(and(eq(reviews.revieweeId, id), isNull(reviews.hiddenAt), isNull(reviews.deletedAt))).orderBy(desc(reviews.createdAt)).limit(10)
    ]);
    res.json({ data: { ...seller, averageRating: Number(rating[0]?.average ?? 0), reviewCount: Number(rating[0]?.count ?? 0), activeListings, recentReviews, soldListingCount: seller.completedSales } });
  }));

  router.get('/leaderboard', asyncRoute(async (req, res) => {
    const scope = req.query.scope === 'monthly' ? 'monthly' : 'all-time';
    const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    const rows = await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, completedSales: sql<number>`count(distinct ${transactions.id})`, averageRating: sql<number>`coalesce(avg(distinct ${reviews.rating}), 0)`, reviewCount: sql<number>`count(distinct ${reviews.id})` }).from(users).innerJoin(transactions, eq(transactions.sellerId, users.id)).leftJoin(reviews, and(eq(reviews.revieweeId, users.id), isNull(reviews.hiddenAt), isNull(reviews.deletedAt))).where(and(eq(transactions.status, 'COMPLETED'), isNull(users.suspendedAt), eq(users.fraudInvestigation, false), ...(scope === 'monthly' ? [gte(transactions.completedAt, since)] : []))).groupBy(users.id).having(sql`count(distinct ${transactions.id}) >= 2`).orderBy(desc(sql`count(distinct ${transactions.id})`), desc(sql`coalesce(avg(distinct ${reviews.rating}), 0)`), desc(sql`count(distinct ${reviews.id})`)).limit(50);
    res.json({ data: rows.map((row, index) => ({ ...row, rank: index + 1 })) });
  }));
  return router;
}
