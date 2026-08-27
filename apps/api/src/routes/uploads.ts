import express, { Router } from 'express';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { listingImages, listings } from '../db/schema.js';
import { requireVerified } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import type { StorageService } from '../services/storage.js';

export function uploadsRouter(db: Database, config: AppConfig, storage: StorageService): Router {
  const router = Router();

  router.put('/uploads/local', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: `${config.MAX_IMAGE_SIZE_MB + 1}mb` }), asyncRoute(async (req, res) => {
    const query = z.object({ key: z.string(), expires: z.coerce.number(), type: z.string(), size: z.coerce.number(), signature: z.string() }).parse(req.query);
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'UPLOAD_BODY_REQUIRED', 'Image bytes are required');
    await storage.acceptLocalUpload(query, req.body);
    res.status(204).end();
  }));

  router.get('/uploads/local-read', asyncRoute(async (req, res) => {
    const query = z.object({ key: z.string(), expires: z.coerce.number(), signature: z.string() }).parse(req.query);
    const buffer = await storage.readLocal(query.key, query.expires, query.signature);
    res.setHeader('content-type', 'image/webp'); res.setHeader('cache-control', 'private, max-age=300'); res.send(buffer);
  }));

  router.post('/uploads/listings/:listingId/presign', requireVerified, asyncRoute(async (req, res) => {
    const listingId = idSchema.parse(req.params.listingId);
    const input = z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), byteSize: z.number().int().positive() }).strict().parse(req.body);
    const listing = (await db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, req.auth!.userId), isNull(listings.deletedAt))).limit(1))[0];
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    if (['SOLD', 'RESERVED'].includes(listing.lifecycleState)) throw new AppError(409, 'LISTING_LOCKED', 'Images cannot be changed now');
    const existing = await db.select({ value: count() }).from(listingImages).where(and(eq(listingImages.listingId, listingId), isNull(listingImages.deletedAt)));
    if ((existing[0]?.value ?? 0) >= config.MAX_LISTING_IMAGES) throw new AppError(400, 'IMAGE_LIMIT_REACHED', `A listing can have up to ${config.MAX_LISTING_IMAGES} images`);
    const ticket = await storage.createUploadTicket(req.auth!.userId, listingId, input.mimeType, input.byteSize);
    const image = (await db.insert(listingImages).values({ listingId, ownerId: req.auth!.userId, tempKey: ticket.tempKey, mimeType: input.mimeType, byteSize: input.byteSize, position: Number(existing[0]?.value ?? 0), syntheticStatus: 'NOT_SYNTHETIC', syntheticDeclaredAt: new Date() }).returning({ id: listingImages.id }))[0]!;
    res.status(201).json({ data: { imageId: image.id, ...ticket } });
  }));

  router.post('/uploads/listings/:listingId/finalize', requireVerified, asyncRoute(async (req, res) => {
    const listingId = idSchema.parse(req.params.listingId);
    const { imageId } = z.object({ imageId: idSchema }).parse(req.body);
    const row = (await db.select({ image: listingImages, listing: listings }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId), eq(listingImages.ownerId, req.auth!.userId), eq(listings.sellerId, req.auth!.userId), isNull(listingImages.deletedAt))).limit(1))[0];
    if (!row?.image.tempKey || row.image.finalizedAt) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
    let result;
    try { result = await storage.finalize(row.image.tempKey, req.auth!.userId, listingId); }
    catch (error) {
      await db.update(listingImages).set({ deletedAt: new Date() }).where(eq(listingImages.id, imageId));
      throw error;
    }
    await db.transaction(async (tx) => {
      await tx.update(listingImages).set({ ...result, tempKey: null, finalizedAt: new Date() }).where(eq(listingImages.id, imageId));
      if (row.listing.moderationState === 'APPROVED') await tx.update(listings).set({ moderationState: 'PENDING', lifecycleState: 'DRAFT', approvedAt: null, updatedAt: new Date() }).where(eq(listings.id, listingId));
    });
    res.json({ data: { id: imageId, ...result } });
  }));

  router.delete('/uploads/listings/:listingId/:imageId', requireVerified, asyncRoute(async (req, res) => {
    const listingId = idSchema.parse(req.params.listingId); const imageId = idSchema.parse(req.params.imageId);
    const row = (await db.select({ image: listingImages, moderationState: listings.moderationState }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId), eq(listingImages.ownerId, req.auth!.userId), eq(listings.sellerId, req.auth!.userId), isNull(listingImages.deletedAt))).limit(1))[0];
    if (!row) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    await db.transaction(async (tx) => {
      await tx.update(listingImages).set({ deletedAt: new Date() }).where(eq(listingImages.id, imageId));
      if (row.moderationState === 'APPROVED') await tx.update(listings).set({ moderationState: 'PENDING', lifecycleState: 'DRAFT', approvedAt: null, updatedAt: new Date() }).where(eq(listings.id, listingId));
    });
    if (row.image.objectKey) await storage.delete(row.image.objectKey);
    if (row.image.tempKey) await storage.delete(row.image.tempKey);
    res.status(204).end();
  }));

  return router;
}
