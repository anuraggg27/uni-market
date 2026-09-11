import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { listingImages } from '../db/schema.js';
import type { StorageService } from './storage.js';

// Upload slots are allocated before finalization and can have gaps after failed
// uploads or deletion. A cover is the earliest usable photo, not position zero.
export async function getListingCoverUrls(db: Database, storage: StorageService, listingIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(listingIds)];
  if (!ids.length) return new Map();
  const images = await db.select({ listingId: listingImages.listingId, objectKey: listingImages.objectKey })
    .from(listingImages)
    .where(and(
      inArray(listingImages.listingId, ids),
      isNull(listingImages.deletedAt),
      isNotNull(listingImages.finalizedAt),
      isNotNull(listingImages.objectKey),
      eq(listingImages.syntheticStatus, 'NOT_SYNTHETIC'),
    ))
    .orderBy(asc(listingImages.position), asc(listingImages.id));
  const keys = new Map<string, string>();
  for (const image of images) {
    if (image.objectKey && !keys.has(image.listingId)) keys.set(image.listingId, image.objectKey);
  }
  return new Map(await Promise.all([...keys].map(async ([id, key]) => [id, await storage.signedReadUrl(key)] as const)));
}
