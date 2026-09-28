import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import express, { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { listingImages, listings } from '../db/schema.js';
import { requireVerified } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { StorageService } from '../services/storage.js';

const uploadInputSchema = z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), byteSize: z.number().int().positive() }).strict();

export function uploadsRouter(db: Database, config: AppConfig, storage: StorageService): Router {
  const router = Router();

  async function allocateUploadTickets(listingId: string, ownerId: string, inputs: z.infer<typeof uploadInputSchema>[]) {
    const startedAt = performance.now();
    const timings: Record<string, number> = {};
    const data = await db.transaction(async (tx) => {
      // A single parent-row lock preserves the image limit and position order
      // for both single and batch allocation, including competing requests.
      let stageStartedAt = performance.now();
      const [listing] = await tx.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, ownerId), isNull(listings.deletedAt))).limit(1).for('update');
      timings.listingLockMs = Math.round(performance.now() - stageStartedAt);
      if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
      if (['SOLD', 'RESERVED'].includes(listing.lifecycleState)) throw new AppError(409, 'LISTING_LOCKED', 'Images cannot be changed now');
      stageStartedAt = performance.now();
      const [allocation] = await tx.select({
        activeCount: sql<number>`count(*) filter (where ${listingImages.deletedAt} is null)::int`,
        // Soft-deleted rows still belong to the unique position index.
        nextPosition: sql<number>`coalesce(max(${listingImages.position}), -1) + 1`,
      }).from(listingImages).where(eq(listingImages.listingId, listingId));
      timings.allocationReadMs = Math.round(performance.now() - stageStartedAt);
      // Approved listings can stage replacement photos while the existing
      // approved photos remain in place until the edit is committed.
      const allocationLimit = listing.moderationState === 'APPROVED' ? config.MAX_LISTING_IMAGES * 2 : config.MAX_LISTING_IMAGES;
      if (allocation!.activeCount + inputs.length > allocationLimit) throw new AppError(400, 'IMAGE_LIMIT_REACHED', `A listing can have up to ${config.MAX_LISTING_IMAGES} images`);
      stageStartedAt = performance.now();
      const tickets = await Promise.all(inputs.map(input => storage.createUploadTicket(ownerId, listingId, input.mimeType, input.byteSize)));
      timings.signingMs = Math.round(performance.now() - stageStartedAt);
      const rows = tickets.map((ticket, index) => ({
        id: randomUUID(),
        listingId,
        ownerId,
        tempKey: ticket.tempKey,
        mimeType: inputs[index]!.mimeType,
        byteSize: inputs[index]!.byteSize,
        position: allocation!.nextPosition + index,
        syntheticStatus: 'NOT_SYNTHETIC',
        syntheticDeclaredAt: new Date(),
      }));
      stageStartedAt = performance.now();
      await tx.insert(listingImages).values(rows);
      timings.insertMs = Math.round(performance.now() - stageStartedAt);
      return tickets.map((ticket, index) => ({ imageId: rows[index]!.id, ...ticket }));
    });
    const totalMs = Math.round(performance.now() - startedAt);
    const details = { listingId, imageCount: inputs.length, totalMs, timings };
    if (totalMs >= 500) logger.warn(details, 'slow listing image presign');
    else logger.debug(details, 'listing image presign');
    return data;
  }

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
    const input = uploadInputSchema.parse(req.body);
    const [data] = await allocateUploadTickets(listingId, req.auth!.userId, [input]);
    res.status(201).json({ data });
  }));

  router.post('/uploads/listings/:listingId/presign-batch', requireVerified, asyncRoute(async (req, res) => {
    const listingId = idSchema.parse(req.params.listingId);
    const { files } = z.object({ files: z.array(uploadInputSchema).min(1).max(config.MAX_LISTING_IMAGES) }).strict().parse(req.body);
    const data = await allocateUploadTickets(listingId, req.auth!.userId, files);
    res.status(201).json({ data });
  }));

  router.post('/uploads/listings/:listingId/finalize', requireVerified, asyncRoute(async (req, res) => {
    const startedAt = performance.now();
    const listingId = idSchema.parse(req.params.listingId);
    const { imageId } = z.object({ imageId: idSchema }).parse(req.body);
    let stageStartedAt = performance.now();
    const row = (await db.select({ image: listingImages, listing: listings }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId), eq(listingImages.ownerId, req.auth!.userId), eq(listings.sellerId, req.auth!.userId), isNull(listingImages.deletedAt))).limit(1))[0];
    const ownershipReadMs = Math.round(performance.now() - stageStartedAt);
    if (!row?.image.tempKey || row.image.finalizedAt) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
    let result;
    stageStartedAt = performance.now();
    try { result = await storage.finalize(row.image.tempKey, req.auth!.userId, listingId, row.image.byteSize, imageId); }
    catch (error) {
      await db.update(listingImages).set({ deletedAt: new Date() }).where(eq(listingImages.id, imageId));
      throw error;
    }
    const storageMs = Math.round(performance.now() - stageStartedAt);
    stageStartedAt = performance.now();
    await db.transaction(async (tx) => {
      await tx.update(listingImages).set({ ...result, tempKey: null, finalizedAt: new Date() }).where(eq(listingImages.id, imageId));
      if (row.listing.moderationState === 'APPROVED') await tx.update(listings).set({ moderationState: 'PENDING', lifecycleState: 'DRAFT', approvedAt: null, updatedAt: new Date() }).where(eq(listings.id, listingId));
    });
    const databaseWriteMs = Math.round(performance.now() - stageStartedAt);
    const totalMs = Math.round(performance.now() - startedAt);
    const details = { imageId, totalMs, ownershipReadMs, storageMs, databaseWriteMs };
    if (totalMs >= 1_000) logger.warn(details, 'slow listing image finalize request');
    else logger.debug(details, 'listing image finalize request');
    res.json({ data: { id: imageId, ...result } });
  }));

  router.delete('/uploads/listings/:listingId/:imageId', requireVerified, asyncRoute(async (req, res) => {
    const listingId = idSchema.parse(req.params.listingId); const imageId = idSchema.parse(req.params.imageId);
    const row = (await db.select({ image: listingImages, moderationState: listings.moderationState }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId), eq(listingImages.ownerId, req.auth!.userId), eq(listings.sellerId, req.auth!.userId), isNull(listingImages.deletedAt))).limit(1))[0];
    if (!row) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    await db.transaction(async (tx) => {
      await tx.update(listingImages).set({ deletedAt: new Date() }).where(eq(listingImages.id, imageId));
      if (row.moderationState === 'APPROVED' && row.image.finalizedAt) await tx.update(listings).set({ moderationState: 'PENDING', lifecycleState: 'DRAFT', approvedAt: null, updatedAt: new Date() }).where(eq(listings.id, listingId));
    });
    if (row.image.objectKey) await storage.delete(row.image.objectKey);
    if (row.image.tempKey) await storage.delete(row.image.tempKey);
    res.status(204).end();
  }));

  return router;
}
