import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentPolicyVersion, idSchema, listingInputSchema } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { categories, listingImages, listings, notifications, prohibitedTerms, reviews, users } from '../db/schema.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import type { StorageService } from '../services/storage.js';
import { matchProhibitedTerms } from '../services/content-risk.js';

const publicListing = and(eq(listings.moderationState, 'APPROVED'), inArray(listings.lifecycleState, ['ACTIVE', 'RESERVED', 'SOLD']), isNull(listings.deletedAt));

function priceLabel(row: { priceType: string; exactPrice: number | null; minimumPrice: number | null; maximumPrice: number | null }): string {
  if (row.priceType === 'FREE') return 'Free';
  if (row.priceType === 'RANGE') return `₹${row.minimumPrice?.toLocaleString('en-IN')}–₹${row.maximumPrice?.toLocaleString('en-IN')}`;
  return `₹${row.exactPrice?.toLocaleString('en-IN')}`;
}

export function listingsRouter(db: Database, config: AppConfig, storage: StorageService): Router {
  const router = Router();

  router.get('/categories', asyncRoute(async (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=300');
    res.json({ data: await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sortOrder), asc(categories.name)) });
  }));

  router.get('/listings', asyncRoute(async (req, res) => {
    const query = z.object({ q: z.string().max(100).optional(), category: z.string().uuid().optional(), minPrice: z.coerce.number().int().min(0).optional(), maxPrice: z.coerce.number().int().min(0).optional(), condition: z.string().optional(), location: z.string().max(120).optional(), negotiable: z.enum(['true', 'false']).optional(), sort: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(48).default(24) }).parse(req.query);
    const conditions = [
      publicListing,
      sql`not exists (select 1 from "listing_images" ai_image where ai_image."listing_id" = ${listings.id} and ai_image."deleted_at" is null and ai_image."synthetic_status" <> 'NOT_SYNTHETIC')`,
    ];
    if (query.q) conditions.push(or(ilike(listings.title, `%${query.q}%`), ilike(listings.description, `%${query.q}%`))!);
    if (query.category) conditions.push(eq(listings.categoryId, query.category));
    if (query.condition) conditions.push(eq(listings.condition, z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).parse(query.condition)));
    if (query.location) conditions.push(ilike(listings.location, `%${query.location}%`));
    if (query.negotiable === 'true') conditions.push(eq(listings.negotiable, true));
    if (query.minPrice !== undefined) conditions.push(or(gte(listings.exactPrice, query.minPrice), gte(listings.maximumPrice, query.minPrice), eq(listings.priceType, 'FREE'))!);
    if (query.maxPrice !== undefined) conditions.push(or(lte(listings.exactPrice, query.maxPrice), lte(listings.minimumPrice, query.maxPrice), eq(listings.priceType, 'FREE'))!);
    const order = query.sort === 'price_asc' ? asc(sql`coalesce(${listings.exactPrice}, ${listings.minimumPrice}, 0)`) : query.sort === 'price_desc' ? desc(sql`coalesce(${listings.exactPrice}, ${listings.maximumPrice}, 0)`) : query.sort === 'popular' ? desc(sql`${listings.viewCount} + ${listings.favouriteCount} * 3`) : desc(listings.approvedAt);
    const rows = await db.select({ listing: listings, categoryName: categories.name, imageKey: listingImages.objectKey }).from(listings).innerJoin(categories, eq(categories.id, listings.categoryId)).leftJoin(listingImages, and(eq(listingImages.listingId, listings.id), eq(listingImages.position, 0), isNull(listingImages.deletedAt))).where(and(...conditions)).orderBy(order, desc(listings.id)).limit(query.limit).offset((query.page - 1) * query.limit);
    const data = await Promise.all(rows.map(async ({ listing, categoryName, imageKey }) => ({ ...listing, categoryName, priceLabel: priceLabel(listing), coverImageUrl: imageKey ? await storage.signedReadUrl(imageKey) : null })));
    res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=60');
    res.json({ data, meta: { page: query.page, limit: query.limit, hasMore: rows.length === query.limit } });
  }));

  router.post('/listings', requireVerified, asyncRoute(async (req, res) => {
    const input = listingInputSchema.parse(req.body);
    const category = (await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.active, true))).limit(1))[0];
    if (!category) throw new AppError(400, 'INVALID_CATEGORY', 'Choose an available category');
    const created = (await db.insert(listings).values({ sellerId: req.auth!.userId, categoryId: input.categoryId, title: input.title, description: input.description, condition: input.condition, conditionExplanation: input.conditionExplanation || null, priceType: input.priceType, exactPrice: input.priceType === 'FIXED' ? input.exactPrice : null, minimumPrice: input.priceType === 'RANGE' ? input.minimumPrice : null, maximumPrice: input.priceType === 'RANGE' ? input.maximumPrice : null, negotiable: input.priceType === 'FREE' ? false : input.negotiable, location: input.location, brand: input.brand || null, defects: input.defects || null, meetupPoint: input.meetupPoint || null, sellerAttestedAt: new Date(), sellerPolicyVersion: currentPolicyVersion, moderationState: 'PENDING', lifecycleState: 'DRAFT' }).returning())[0]!;
    res.status(201).json({ data: created });
  }));

  router.get('/my-listings', requireAuth, asyncRoute(async (req, res) => {
    const rows = await db.select({ listing: listings, imageKey: listingImages.objectKey }).from(listings).leftJoin(listingImages, and(eq(listingImages.listingId, listings.id), eq(listingImages.position, 0), isNull(listingImages.deletedAt))).where(and(eq(listings.sellerId, req.auth!.userId), isNull(listings.deletedAt))).orderBy(desc(listings.updatedAt));
    res.json({ data: await Promise.all(rows.map(async ({ listing, imageKey }) => ({ ...listing, priceLabel: priceLabel(listing), coverImageUrl: imageKey ? await storage.signedReadUrl(imageKey) : null }))) });
  }));

  router.get('/listings/:id', asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const listing = (await db.select({ listing: listings, seller: { id: users.id, displayName: users.displayName, avatarId: users.avatarId, institution: users.institution, campus: users.campus, phoneVerifiedAt: users.phoneVerifiedAt, completedSales: users.completedSales, createdAt: users.createdAt } }).from(listings).innerJoin(users, eq(users.id, listings.sellerId)).where(and(eq(listings.id, id), isNull(listings.deletedAt))).limit(1))[0];
    if (!listing) throw new AppError(404, 'LISTING_UNAVAILABLE', 'This listing is unavailable');
    const privileged = req.auth?.userId === listing.listing.sellerId || req.auth?.roles.some((role: string) => ['MODERATOR', 'SUPER_ADMIN'].includes(role));
    if (!privileged && !(listing.listing.moderationState === 'APPROVED' && ['ACTIVE', 'RESERVED', 'SOLD'].includes(listing.listing.lifecycleState))) throw new AppError(404, 'LISTING_UNAVAILABLE', 'This listing is unavailable');
    const [images, rating] = await Promise.all([
      db.select().from(listingImages).where(and(eq(listingImages.listingId, id), isNull(listingImages.deletedAt))).orderBy(asc(listingImages.position)),
      db.select({ average: sql<number>`coalesce(avg(${reviews.rating}), 0)`, count: sql<number>`count(*)` }).from(reviews).where(and(eq(reviews.revieweeId, listing.listing.sellerId), isNull(reviews.hiddenAt), isNull(reviews.deletedAt)))
    ]);
    if (!privileged && images.some((image) => image.syntheticStatus !== 'NOT_SYNTHETIC')) throw new AppError(404, 'LISTING_UNAVAILABLE', 'This listing is unavailable');
    if (!privileged) await db.update(listings).set({ viewCount: sql`${listings.viewCount} + 1` }).where(eq(listings.id, id));
    res.json({ data: { ...listing.listing, priceLabel: priceLabel(listing.listing), seller: { ...listing.seller, email: undefined, phone: undefined, rating: Number(rating[0]?.average ?? 0), reviewCount: Number(rating[0]?.count ?? 0) }, images: await Promise.all(images.filter((image) => image.objectKey).map(async (image) => ({ id: image.id, position: image.position, width: image.width, height: image.height, url: await storage.signedReadUrl(image.objectKey!) }))), ownerPreview: privileged && listing.listing.moderationState !== 'APPROVED' } });
  }));

  router.patch('/listings/:id', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id); const input = listingInputSchema.parse(req.body);
    const current = (await db.select().from(listings).where(and(eq(listings.id, id), isNull(listings.deletedAt))).limit(1))[0];
    if (!current || current.sellerId !== req.auth!.userId) throw new AppError(403, 'LISTING_FORBIDDEN', 'You cannot edit this listing');
    if (['SOLD', 'RESERVED'].includes(current.lifecycleState)) throw new AppError(409, 'LISTING_LOCKED', 'This listing cannot be edited in its current state');
    const wasPublic = current.moderationState === 'APPROVED';
    const updated = (await db.update(listings).set({ categoryId: input.categoryId, title: input.title, description: input.description, condition: input.condition, conditionExplanation: input.conditionExplanation || null, priceType: input.priceType, exactPrice: input.priceType === 'FIXED' ? input.exactPrice : null, minimumPrice: input.priceType === 'RANGE' ? input.minimumPrice : null, maximumPrice: input.priceType === 'RANGE' ? input.maximumPrice : null, negotiable: input.priceType === 'FREE' ? false : input.negotiable, location: input.location, brand: input.brand || null, defects: input.defects || null, meetupPoint: input.meetupPoint || null, sellerAttestedAt: new Date(), sellerPolicyVersion: currentPolicyVersion, ...(wasPublic ? { moderationState: 'PENDING' as const, lifecycleState: 'DRAFT' as const, submittedAt: new Date(), approvedAt: null } : {}), updatedAt: new Date() }).where(eq(listings.id, id)).returning())[0]!;
    res.json({ data: updated });
  }));

  router.post('/listings/:id/submit', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const listing = (await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.sellerId, req.auth!.userId), isNull(listings.deletedAt))).limit(1))[0];
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    if (!['DRAFT', 'WITHDRAWN'].includes(listing.lifecycleState) || !['PENDING', 'REJECTED'].includes(listing.moderationState) || (listing.moderationState === 'PENDING' && listing.submittedAt)) throw new AppError(409, 'INVALID_LISTING_STATE', 'This listing cannot be submitted');
    if (!listing.sellerAttestedAt || listing.sellerPolicyVersion !== currentPolicyVersion) throw new AppError(400, 'SELLER_ATTESTATION_REQUIRED', 'Review and accept the current seller declarations');
    const images = await db.select({ id: listingImages.id, syntheticStatus: listingImages.syntheticStatus }).from(listingImages).where(and(eq(listingImages.listingId, id), sql`${listingImages.finalizedAt} is not null`, isNull(listingImages.deletedAt)));
    if (!images.length) throw new AppError(400, 'IMAGE_REQUIRED', 'Add at least one product image before submitting');
    if (images.some((image) => image.syntheticStatus !== 'NOT_SYNTHETIC')) throw new AppError(400, 'AI_GENERATED_IMAGE_NOT_ALLOWED', 'AI-generated or materially altered listing images are not allowed');
    const activeTerms = await db.select({ term: prohibitedTerms.term, severity: prohibitedTerms.severity }).from(prohibitedTerms).where(eq(prohibitedTerms.active, true));
    const matches = matchProhibitedTerms(`${listing.title} ${listing.description} ${listing.defects ?? ''} ${listing.brand ?? ''}`, activeTerms);
    if (matches.some(({ severity }) => severity === 'BLOCK')) throw new AppError(400, 'PROHIBITED_LISTING', 'This listing appears to contain an item that is not permitted on Uni Market');
    const riskCodes = matches.map(({ term, severity }) => `${severity}:${term}`);
    const updated = await db.transaction(async (tx) => {
      const now = new Date();
      const row = (await tx.update(listings).set({ moderationState: 'PENDING', lifecycleState: 'DRAFT', moderationRiskCodes: riskCodes, rejectionReason: null, requestedChanges: null, submittedAt: now, updatedAt: now }).where(eq(listings.id, id)).returning())[0]!;
      await tx.insert(notifications).values({ userId: req.auth!.userId, type: 'LISTING_SUBMITTED', title: 'Listing submitted', body: 'Your listing is waiting for manual review', href: `/listing/${id}` });
      return row;
    });
    res.json({ data: updated });
  }));

  router.post('/listings/:id/withdraw', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const updated = (await db.update(listings).set({ lifecycleState: 'WITHDRAWN', withdrawnAt: new Date(), updatedAt: new Date() }).where(and(eq(listings.id, id), eq(listings.sellerId, req.auth!.userId), eq(listings.lifecycleState, 'ACTIVE'), eq(listings.moderationState, 'APPROVED'))).returning())[0];
    if (!updated) throw new AppError(409, 'INVALID_LISTING_STATE', 'Only your active listing can be withdrawn');
    res.json({ data: updated });
  }));

  router.delete('/listings/:id', requireAuth, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const deleted = (await db.update(listings).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(listings.id, id), eq(listings.sellerId, req.auth!.userId), isNull(listings.deletedAt))).returning({ id: listings.id }))[0];
    if (!deleted) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    res.status(204).send();
  }));
  router.post('/listings/:id/sold', requireVerified, (_req, _res, next) => next(new AppError(409, 'TRANSACTION_REQUIRED', 'Complete a transaction before a listing can be sold')));

  router.post('/listings/:id/duplicate', requireVerified, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const source = (await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.sellerId, req.auth!.userId))).limit(1))[0];
    if (!source) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    const duplicate = (await db.insert(listings).values({ sellerId: source.sellerId, categoryId: source.categoryId, title: source.title, description: source.description, condition: source.condition, conditionExplanation: source.conditionExplanation, priceType: source.priceType, exactPrice: source.exactPrice, minimumPrice: source.minimumPrice, maximumPrice: source.maximumPrice, negotiable: source.negotiable, location: source.location, brand: source.brand, defects: source.defects, meetupPoint: source.meetupPoint, moderationState: 'PENDING', lifecycleState: 'DRAFT' }).returning())[0]!;
    res.status(201).json({ data: duplicate });
  }));

  return router;
}
