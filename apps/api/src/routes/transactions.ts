import { Router } from 'express';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { idSchema, reviewSchema } from '@campus-market/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { blocks, conversations, listings, messages, notifications, reviews, transactions, users } from '../db/schema.js';
import { requireVerified } from '../middleware/auth.js';
import { keyedHash, safeEqual } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { queueUserEmail } from '../services/email-preferences.js';

type TransactionRow = typeof transactions.$inferSelect;

const exchangeCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit exchange code') });

function deriveExchangeCode(transaction: Pick<TransactionRow, 'id' | 'buyerId' | 'exchangeCodeVersion'>, secret: string): string {
  const digest = keyedHash(`exchange-code:${transaction.id}:${transaction.buyerId}:v${transaction.exchangeCodeVersion}`, secret);
  return (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000n).toString().padStart(6, '0');
}

function listingPriceLabel(listing: Pick<typeof listings.$inferSelect, 'priceType' | 'exactPrice' | 'minimumPrice' | 'maximumPrice'>): string {
  if (listing.priceType === 'FREE') return 'Free';
  if (listing.priceType === 'RANGE') return `₹${listing.minimumPrice?.toLocaleString('en-IN')}–₹${listing.maximumPrice?.toLocaleString('en-IN')}`;
  return `₹${listing.exactPrice?.toLocaleString('en-IN')}`;
}

function publicTransaction(transaction: TransactionRow, userId: string, config: AppConfig, listingSummary?: { title: string; priceLabel: string }) {
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
    ...(listingSummary === undefined ? {} : { listingTitle: listingSummary.title, listingPrice: listingSummary.priceLabel }),
    role,
    ...(transaction.status === 'RESERVED' ? { exchangeCodeLocked: Boolean(transaction.exchangeCodeLockedAt) } : {}),
    ...(role === 'BUYER' && transaction.status === 'RESERVED' ? { exchangeCode: deriveExchangeCode(transaction, config.SESSION_SECRET) } : {}),
  };
}

export function transactionsRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.get('/transactions', requireVerified, asyncRoute(async (req, res) => {
    const rows = await db.select({ transaction: transactions, listing: { title: listings.title, priceType: listings.priceType, exactPrice: listings.exactPrice, minimumPrice: listings.minimumPrice, maximumPrice: listings.maximumPrice } }).from(transactions).innerJoin(listings, eq(listings.id, transactions.listingId)).where(or(eq(transactions.buyerId, req.auth!.userId), eq(transactions.sellerId, req.auth!.userId))).orderBy(desc(transactions.updatedAt));
    res.json({ data: rows.map((row) => publicTransaction(row.transaction, req.auth!.userId, config, { title: row.listing.title, priceLabel: listingPriceLabel(row.listing) })) });
  }));

  router.post('/conversations/:id/reservation-requests', requireVerified, asyncRoute(async (req, res) => {
    const conversationId = idSchema.parse(req.params.id);
    const conversation = (await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1))[0];
    if (!conversation || conversation.buyerId !== req.auth!.userId) {
      throw new AppError(403, 'RESERVATION_REQUEST_FORBIDDEN', 'Only the interested student in this conversation can request a reservation');
    }

    const [listing, buyerMessage, blockedRelationship, existingRequest] = await Promise.all([
      db.select().from(listings).where(and(eq(listings.id, conversation.listingId), isNull(listings.deletedAt))).limit(1),
      db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.senderId, conversation.buyerId), isNull(messages.deletedAt))).limit(1),
      db.select({ blockerId: blocks.blockerId }).from(blocks).where(or(
        and(eq(blocks.blockerId, conversation.buyerId), eq(blocks.blockedId, conversation.sellerId)),
        and(eq(blocks.blockerId, conversation.sellerId), eq(blocks.blockedId, conversation.buyerId)),
      )).limit(1),
      db.select().from(transactions).where(and(eq(transactions.listingId, conversation.listingId), eq(transactions.buyerId, conversation.buyerId), inArray(transactions.status, ['REQUESTED', 'ACCEPTED', 'RESERVED', 'HANDED_OVER']))).limit(1),
    ]);

    if (blockedRelationship.length) throw new AppError(403, 'USER_BLOCKED', 'A reservation cannot be requested in this conversation');
    const existing = existingRequest[0];
    if (existing) { res.json({ data: publicTransaction(existing, req.auth!.userId, config) }); return; }
    if (!buyerMessage.length) throw new AppError(409, 'MESSAGE_REQUIRED', 'Send the seller a message before requesting a reservation');
    const availableListing = listing[0];
    if (!availableListing || availableListing.moderationState !== 'APPROVED' || availableListing.lifecycleState !== 'ACTIVE') throw new AppError(409, 'LISTING_NOT_AVAILABLE', 'This listing is not available for reservation');
    const transaction = await db.transaction(async (tx) => {
      const created = (await tx.insert(transactions).values({ listingId: availableListing.id, buyerId: conversation.buyerId, sellerId: conversation.sellerId }).returning())[0]!;
      await tx.insert(notifications).values({ userId: conversation.sellerId, type: 'PURCHASE_REQUEST', title: 'Reservation request', body: `A student asked you to reserve ${availableListing.title}`, href: `/requests?view=received#transaction-${created.id}` });
      await queueUserEmail(tx, { recipientUserId: conversation.sellerId, template: 'purchase-request', payload: { transactionId: created.id, listingId: availableListing.id, listingTitle: availableListing.title }, dedupeKey: `purchase-request:${created.id}` });
      return created;
    });
    res.status(201).json({ data: publicTransaction(transaction, req.auth!.userId, config) });
  }));

  router.post('/transactions', requireVerified, asyncRoute(async () => {
    throw new AppError(409, 'CHAT_REQUIRED', 'Start a conversation and send the seller a message before requesting a reservation');
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
      await tx.insert(notifications).values([{ userId: transaction.buyerId, type: 'REQUEST_ACCEPTED', title: 'Reservation confirmed', body: 'The seller reserved this listing for you. Your exchange code is ready in Requests.', href: `/requests?view=sent#transaction-${updated.id}` }, { userId: transaction.buyerId, type: 'LISTING_RESERVED', title: 'Listing reserved', body: 'This listing is now reserved for you', href: `/listing/${transaction.listingId}` }]);
      await queueUserEmail(tx, { recipientUserId: transaction.buyerId, template: 'purchase-accepted', payload: { transactionId: updated.id, listingId: reserved.id, listingTitle: reserved.title }, dedupeKey: `purchase-accepted:${updated.id}` });
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
      const sold = (await tx.update(listings).set({ lifecycleState: 'SOLD', soldAt: now, updatedAt: now }).where(and(eq(listings.id, updated.listingId), eq(listings.lifecycleState, 'RESERVED'), eq(listings.reservedBuyerId, updated.buyerId))).returning({ id: listings.id, title: listings.title }))[0];
      if (!sold) throw new AppError(409, 'LISTING_STATE_CHANGED', 'This listing can no longer be completed');
      await tx.update(users).set({ completedSales: sql`${users.completedSales} + 1`, updatedAt: now }).where(eq(users.id, updated.sellerId));
      await tx.insert(notifications).values([
        { userId: updated.buyerId, type: 'TRANSACTION_COMPLETED', title: 'Exchange complete', body: 'Your exchange was completed. You can now leave a review.', href: `/requests?view=sent#transaction-${updated.id}` },
        { userId: updated.sellerId, type: 'TRANSACTION_COMPLETED', title: 'Exchange complete', body: 'The exchange code was accepted and this exchange is complete.', href: `/requests?view=received#transaction-${updated.id}` },
      ]);
      await Promise.all([
        queueUserEmail(tx, { recipientUserId: updated.buyerId, template: 'transaction-completed-buyer', payload: { transactionId: updated.id, listingId: sold.id, listingTitle: sold.title }, dedupeKey: `transaction-completed-buyer:${updated.id}` }),
        queueUserEmail(tx, { recipientUserId: updated.sellerId, template: 'transaction-completed-seller', payload: { transactionId: updated.id, listingId: sold.id, listingTitle: sold.title }, dedupeKey: `transaction-completed-seller:${updated.id}` }),
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
      const sold = (await tx.update(listings).set({ lifecycleState: 'SOLD', soldAt: new Date(), updatedAt: new Date() }).where(and(eq(listings.id, updated.listingId), eq(listings.lifecycleState, 'RESERVED'), eq(listings.reservedBuyerId, updated.buyerId))).returning({ id: listings.id, title: listings.title }))[0];
      if (!sold) throw new AppError(409, 'LISTING_STATE_CHANGED', 'This listing can no longer be completed');
      await tx.update(users).set({ completedSales: sql`${users.completedSales} + 1`, updatedAt: new Date() }).where(eq(users.id, updated.sellerId));
      await tx.insert(notifications).values({ userId: updated.sellerId, type: 'TRANSACTION_COMPLETED', title: 'Exchange complete', body: 'The other student confirmed receipt', href: `/requests?view=received#transaction-${updated.id}` });
      await Promise.all([
        queueUserEmail(tx, { recipientUserId: updated.buyerId, template: 'transaction-completed-buyer', payload: { transactionId: updated.id, listingId: sold.id, listingTitle: sold.title }, dedupeKey: `transaction-completed-buyer:${updated.id}` }),
        queueUserEmail(tx, { recipientUserId: updated.sellerId, template: 'transaction-completed-seller', payload: { transactionId: updated.id, listingId: sold.id, listingTitle: sold.title }, dedupeKey: `transaction-completed-seller:${updated.id}` }),
      ]);
      return updated;
    });
    res.json({ data: publicTransaction(completed, req.auth!.userId, config) });
  }));

  router.post('/transactions/:id/cancel', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const row = (await db.select({ transaction: transactions, listingTitle: listings.title }).from(transactions).innerJoin(listings, eq(listings.id, transactions.listingId)).where(eq(transactions.id, id)).limit(1))[0];
    const transaction = row?.transaction;
    if (!transaction || ![transaction.buyerId, transaction.sellerId].includes(req.auth!.userId)) throw new AppError(403, 'TRANSACTION_FORBIDDEN', 'You cannot cancel this transaction');
    if (!['REQUESTED', 'ACCEPTED', 'RESERVED'].includes(transaction.status)) throw new AppError(409, 'INVALID_TRANSACTION_STATE', 'This transaction can no longer be cancelled');
    const cancelledByBuyer = req.auth!.userId === transaction.buyerId;
    const status = cancelledByBuyer ? 'CANCELLED_BY_BUYER' : 'CANCELLED_BY_SELLER';
    const updated = await db.transaction(async (tx) => {
      const changed = (await tx.update(transactions).set({ status, cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(transactions.id, id), inArray(transactions.status, ['REQUESTED', 'ACCEPTED', 'RESERVED']))).returning())[0]!;
      if (transaction.status === 'RESERVED') await tx.update(listings).set({ lifecycleState: 'ACTIVE', reservedBuyerId: null, updatedAt: new Date() }).where(and(eq(listings.id, transaction.listingId), eq(listings.reservedBuyerId, transaction.buyerId)));
      const recipientUserId = cancelledByBuyer ? transaction.sellerId : transaction.buyerId;
      await queueUserEmail(tx, { recipientUserId, template: 'transaction-cancelled', payload: { transactionId: changed.id, listingId: changed.listingId, listingTitle: row.listingTitle, cancelledBy: cancelledByBuyer ? 'The buyer' : 'The seller', recipientRole: cancelledByBuyer ? 'SELLER' : 'BUYER' }, dedupeKey: `transaction-cancelled:${changed.id}:${status}` });
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
      await db.insert(notifications).values({ userId: revieweeId, type: 'REVIEW_RECEIVED', title: 'New review', body: 'You received a verified exchange review', href: `/seller/${revieweeId}` });
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
    const seller = (await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, avatarId: users.avatarId, institution: users.institution, campus: users.campus, phoneVerifiedAt: users.phoneVerifiedAt, completedSales: users.completedSales, createdAt: users.createdAt }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt), isNull(users.suspendedAt))).limit(1))[0];
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
    const rows = await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, avatarId: users.avatarId, completedSales: sql<number>`count(distinct ${transactions.id})`, averageRating: sql<number>`coalesce(avg(distinct ${reviews.rating}), 0)`, reviewCount: sql<number>`count(distinct ${reviews.id})` }).from(users).innerJoin(transactions, eq(transactions.sellerId, users.id)).leftJoin(reviews, and(eq(reviews.revieweeId, users.id), isNull(reviews.hiddenAt), isNull(reviews.deletedAt))).where(and(eq(transactions.status, 'COMPLETED'), isNull(users.suspendedAt), eq(users.fraudInvestigation, false), ...(scope === 'monthly' ? [gte(transactions.completedAt, since)] : []))).groupBy(users.id).having(sql`count(distinct ${transactions.id}) >= 2`).orderBy(desc(sql`count(distinct ${transactions.id})`), desc(sql`coalesce(avg(distinct ${reviews.rating}), 0)`), desc(sql`count(distinct ${reviews.id})`)).limit(50);
    res.json({ data: rows.map((row, index) => ({ ...row, rank: index + 1 })) });
  }));
  return router;
}
