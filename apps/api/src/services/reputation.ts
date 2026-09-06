import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reviews, transactions, users } from '../db/schema.js';

type ReviewRole = 'BUYER' | 'SELLER';

function reviewScope(userId: string, role: ReviewRole) {
  return and(
    eq(reviews.revieweeId, userId),
    eq(role === 'SELLER' ? transactions.sellerId : transactions.buyerId, userId),
    eq(reviews.reviewerId, role === 'SELLER' ? transactions.buyerId : transactions.sellerId),
    eq(transactions.status, 'COMPLETED'),
    isNull(reviews.hiddenAt),
    isNull(reviews.deletedAt),
  );
}

export async function getReviewSummary(db: Database, userId: string, role: ReviewRole) {
  const [summary] = await db.select({ average: sql<number>`coalesce(avg(${reviews.rating}), 0)`, count: sql<number>`count(*)` })
    .from(reviews).innerJoin(transactions, eq(transactions.id, reviews.transactionId))
    .where(reviewScope(userId, role));
  return { averageRating: Number(summary?.average ?? 0), reviewCount: Number(summary?.count ?? 0) };
}

export async function getReputation(db: Database, userId: string, role: ReviewRole) {
  const [summary, recentReviews] = await Promise.all([
    getReviewSummary(db, userId, role),
    db.select({
      id: reviews.id,
      rating: reviews.rating,
      text: reviews.text,
      tags: reviews.tags,
      createdAt: reviews.createdAt,
      reviewerName: users.displayName,
      reviewerAvatarId: users.avatarId,
    })
      .from(reviews).innerJoin(transactions, eq(transactions.id, reviews.transactionId))
      .innerJoin(users, eq(users.id, reviews.reviewerId))
      .where(reviewScope(userId, role)).orderBy(desc(reviews.createdAt)).limit(10),
  ]);
  return { ...summary, recentReviews };
}
