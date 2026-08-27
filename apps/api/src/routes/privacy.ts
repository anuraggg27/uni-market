import { Router } from 'express';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailPreferences, listingImages, listings, messages, notifications, phoneVerifications, policyAcceptances, reports, reviews, sessions, studentEmailVerifications, supportMessages, supportTickets, transactions, users } from '../db/schema.js';
import { decryptText } from '../lib/crypto.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { defaultEmailPreferences, resolvedEmailPreferences } from '../services/email-preferences.js';

const emailPreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  listingUpdates: z.boolean().optional(),
  transactionUpdates: z.boolean().optional(),
  messageUpdates: z.boolean().optional(),
  policyReminders: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Change at least one email preference');

export function privacyRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.get('/email-preferences', requireAuth, asyncRoute(async (req, res) => {
    const stored = (await db.select().from(emailPreferences).where(eq(emailPreferences.userId, req.auth!.userId)).limit(1))[0];
    res.setHeader('cache-control', 'no-store');
    res.json({ data: { ...resolvedEmailPreferences(stored), updatedAt: stored?.updatedAt ?? null } });
  }));

  router.patch('/email-preferences', requireAuth, asyncRoute(async (req, res) => {
    const input = emailPreferencesSchema.parse(req.body);
    const now = new Date();
    const stored = (await db.insert(emailPreferences).values({
      userId: req.auth!.userId,
      ...defaultEmailPreferences,
      ...input,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: emailPreferences.userId,
      set: { ...input, updatedAt: now },
    }).returning())[0]!;
    res.setHeader('cache-control', 'no-store');
    res.json({ data: { ...resolvedEmailPreferences(stored), updatedAt: stored.updatedAt } });
  }));

  router.get('/account/export', requireAuth, asyncRoute(async (req, res) => {
    const userId = req.auth!.userId;
    const [userRows, acceptanceRows, listingRows, imageRows, ownMessages, transactionRows, authoredReviews, receivedReviews, reportRows, ticketRows, notificationRows, emailPreferenceRows] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(policyAcceptances).where(eq(policyAcceptances.userId, userId)),
      db.select().from(listings).where(eq(listings.sellerId, userId)),
      db.select({ id: listingImages.id, listingId: listingImages.listingId, mimeType: listingImages.mimeType, byteSize: listingImages.byteSize, width: listingImages.width, height: listingImages.height, createdAt: listingImages.createdAt, deletedAt: listingImages.deletedAt }).from(listingImages).where(eq(listingImages.ownerId, userId)),
      db.select({ id: messages.id, conversationId: messages.conversationId, body: messages.body, deliveredAt: messages.deliveredAt, readAt: messages.readAt, deletedAt: messages.deletedAt, createdAt: messages.createdAt }).from(messages).where(eq(messages.senderId, userId)),
      db.select({ id: transactions.id, listingId: transactions.listingId, buyerId: transactions.buyerId, sellerId: transactions.sellerId, status: transactions.status, completedAt: transactions.completedAt, cancelledAt: transactions.cancelledAt, disputeReason: transactions.disputeReason, createdAt: transactions.createdAt, updatedAt: transactions.updatedAt }).from(transactions).where(or(eq(transactions.buyerId, userId), eq(transactions.sellerId, userId))),
      db.select({ id: reviews.id, transactionId: reviews.transactionId, revieweeId: reviews.revieweeId, rating: reviews.rating, text: reviews.text, tags: reviews.tags, createdAt: reviews.createdAt }).from(reviews).where(eq(reviews.reviewerId, userId)),
      db.select({ id: reviews.id, transactionId: reviews.transactionId, rating: reviews.rating, text: reviews.text, tags: reviews.tags, createdAt: reviews.createdAt }).from(reviews).where(eq(reviews.revieweeId, userId)),
      db.select({ id: reports.id, publicReference: reports.publicReference, category: reports.category, targetType: reports.targetType, targetId: reports.targetId, targetUrl: reports.targetUrl, reason: reports.reason, details: reports.details, status: reports.status, publicResponse: reports.publicResponse, createdAt: reports.createdAt, resolvedAt: reports.resolvedAt }).from(reports).where(eq(reports.reporterId, userId)),
      db.select().from(supportTickets).where(eq(supportTickets.userId, userId)),
      db.select().from(notifications).where(eq(notifications.userId, userId)),
      db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1),
    ]);
    const user = userRows[0];
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
    const ticketIds = ticketRows.map(({ id }) => id);
    const publicSupportMessages = ticketIds.length ? await db.select({ id: supportMessages.id, ticketId: supportMessages.ticketId, senderId: supportMessages.senderId, body: supportMessages.body, createdAt: supportMessages.createdAt }).from(supportMessages).where(and(inArray(supportMessages.ticketId, ticketIds), eq(supportMessages.internal, false))) : [];
    const exportData = {
      generatedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        institution: user.institution,
        campus: user.campus,
        graduationYear: user.graduationYear,
        phone: user.phoneE164,
        phoneVerifiedAt: user.phoneVerifiedAt,
        studentEmail: user.studentEmailCiphertext ? decryptText(user.studentEmailCiphertext, config.DATA_ENCRYPTION_KEY) : null,
        studentEmailVerifiedAt: user.studentEmailVerifiedAt,
        studentEmailExpiresAt: user.studentEmailExpiresAt,
        adultAttestedAt: user.adultAttestedAt,
        createdAt: user.createdAt,
      },
      policyAcceptances: acceptanceRows,
      listings: listingRows,
      listingImages: imageRows,
      messagesAuthoredByYou: ownMessages,
      transactions: transactionRows.map((transaction) => ({ ...transaction, buyerId: transaction.buyerId === userId ? 'YOU' : 'OTHER_USER', sellerId: transaction.sellerId === userId ? 'YOU' : 'OTHER_USER' })),
      reviewsAuthoredByYou: authoredReviews.map((review) => ({ id: review.id, transactionId: review.transactionId, rating: review.rating, text: review.text, tags: review.tags, createdAt: review.createdAt })),
      reviewsAboutYou: receivedReviews,
      grievancesAndReports: reportRows,
      supportTickets: ticketRows,
      supportMessages: publicSupportMessages.map(({ senderId, ...message }) => ({ ...message, sender: senderId === userId ? 'YOU' : 'SUPPORT' })),
      notifications: notificationRows,
      emailPreferences: resolvedEmailPreferences(emailPreferenceRows[0]),
    };
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-disposition', `attachment; filename="uni-market-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportData);
  }));

  router.delete('/account', requireAuth, asyncRoute(async (req, res) => {
    z.object({ confirmation: z.literal('DELETE MY ACCOUNT') }).parse(req.body);
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 180 * 24 * 60 * 60_000);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ closedAt: now, deletedAt: now, purgeAfter, updatedAt: now }).where(eq(users.id, req.auth!.userId));
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, req.auth!.userId));
      await tx.update(phoneVerifications).set({ invalidatedAt: now }).where(eq(phoneVerifications.userId, req.auth!.userId));
      await tx.update(studentEmailVerifications).set({ invalidatedAt: now }).where(eq(studentEmailVerifications.userId, req.auth!.userId));
      await tx.update(listings).set({ moderationState: 'REMOVED', lifecycleState: 'WITHDRAWN', withdrawnAt: now, approvedAt: null, updatedAt: now }).where(eq(listings.sellerId, req.auth!.userId));
    });
    res.clearCookie('campus_session', { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.status(204).end();
  }));

  router.post('/account/revoke-sessions', requireAuth, asyncRoute(async (req, res) => {
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, req.auth!.userId), ne(sessions.id, req.auth!.sessionId)));
    res.status(204).end();
  }));

  return router;
}
