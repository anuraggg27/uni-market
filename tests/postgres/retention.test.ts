import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../../apps/api/src/db/client';
import { loadConfig } from '../../apps/api/src/config';
import { categories, legalHolds, listingImages, listings, retentionRuns, users } from '../../apps/api/src/db/schema';
import { RETENTION_LOCK_ID, RetentionWorker } from '../../apps/api/src/services/retention';
import type { StorageService } from '../../apps/api/src/services/storage';

// This suite deliberately uses the production adapter, not PGlite. Never point
// it at a deployed database: it exercises actual retention enforcement.
const databaseUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!databaseUrl)('retention on real PostgreSQL', () => {
  const config = loadConfig({ NODE_ENV: 'test', APP_ENV: 'test', DEV_MODE: 'true',
    CLIENT_URL: 'http://localhost:5173', API_URL: 'http://localhost:4000',
    DATABASE_URL: databaseUrl ?? 'pglite://:memory:',
    SESSION_SECRET: 'retention-test-session-secret-32-chars', CSRF_SECRET: 'retention-test-csrf-secret-32-chars',
  });
  let connection: ReturnType<typeof createDatabase>;
  let control: ReturnType<typeof postgres>;
  const storage = { delete: vi.fn(async () => undefined) };
  const marker = randomUUID();
  let eligibleId: string;
  let heldId: string;
  let failedImageId: string;
  let listingId: string;
  const run = (mode: 'dry-run' | 'enforce' = 'dry-run') => new RetentionWorker(connection.db, { ...config, RETENTION_MODE: mode }, storage as unknown as StorageService).runOnce();

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/uni_market_retention_test') throw new Error('Use an isolated local uni_market_retention_test database');
    control = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    await migrate(drizzle(control), { migrationsFolder: resolve('apps/api/drizzle') });
    connection = createDatabase(config);
    const due = new Date(Date.now() - 24 * 60 * 60_000);
    const [eligible, held] = await connection.db.insert(users).values([
      { email: `eligible-${marker}@example.test`, displayName: 'Expired account', closedAt: due, deletedAt: due, purgeAfter: due },
      { email: `held-${marker}@example.test`, displayName: 'Held account', closedAt: due, deletedAt: due, purgeAfter: due },
    ]).returning();
    eligibleId = eligible!.id;
    heldId = held!.id;
    await connection.db.insert(legalHolds).values({ targetType: 'USER', targetId: heldId, reason: 'Retention test hold', createdBy: heldId, reviewAt: new Date(Date.now() + 24 * 60 * 60_000) });
    const [category] = await connection.db.insert(categories).values({ name: `Books ${marker}`, slug: `books-${marker}` }).returning();
    const [listing] = await connection.db.insert(listings).values({ sellerId: eligibleId, categoryId: category!.id, title: 'Expired listing', description: 'A fixture for retention verification.', condition: 'GOOD', priceType: 'FREE', location: 'Test campus' }).returning();
    listingId = listing!.id;
  });

  afterAll(async () => { await connection?.close(); await control?.end(); });

  it('reproduces the adapter shape and records a non-destructive dry run', async () => {
    const raw = await connection.db.execute(sql`SELECT true AS locked`);
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.rows).toBeUndefined();
    await run();
    const records = await connection.db.select().from(retentionRuns);
    expect(records.at(-1)).toMatchObject({ mode: 'dry-run', status: 'COMPLETED', counts: { users: 1 } });
    const [user] = await connection.db.select().from(users).where(eq(users.id, eligibleId));
    expect(user!.purgeAfter).not.toBeNull();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('skips competing runs and releases the transaction lock afterwards', async () => {
    const before = (await connection.db.select().from(retentionRuns)).length;
    await control.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${RETENTION_LOCK_ID})`;
      await run();
      expect(await connection.db.select().from(retentionRuns)).toHaveLength(before);
    });
    await run();
    expect(await connection.db.select().from(retentionRuns)).toHaveLength(before + 1);
    await control.begin(async (tx) => {
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS locked`;
      expect(lock!.locked).toBe(true);
    });
  });

  it('rolls back on failure, records it and allows a subsequent retry', async () => {
    const [image] = await connection.db.insert(listingImages).values({ listingId, ownerId: eligibleId, position: 0, tempKey: `test/${marker}`, mimeType: 'image/jpeg', byteSize: 10, createdAt: new Date(0) }).returning();
    failedImageId = image!.id;
    storage.delete.mockRejectedValueOnce(new Error('Simulated storage failure'));
    await expect(run('enforce')).resolves.toBeUndefined();
    const [failure] = await connection.db.select().from(retentionRuns).where(eq(retentionRuns.status, 'FAILED'));
    expect(failure!.error).toContain('Simulated storage failure');
    const [user] = await connection.db.select().from(users).where(eq(users.id, eligibleId));
    expect(user!.purgeAfter).not.toBeNull();
    await run('enforce');
    const [purged] = await connection.db.select().from(users).where(eq(users.id, eligibleId));
    const [held] = await connection.db.select().from(users).where(eq(users.id, heldId));
    const [removedImage] = await connection.db.select().from(listingImages).where(eq(listingImages.id, failedImageId));
    expect(purged!.email).toBe(`deleted+${eligibleId}@invalid.local`);
    expect(purged!.purgeAfter).toBeNull();
    expect(held!.purgeAfter).not.toBeNull();
    expect(removedImage!.deletedAt).not.toBeNull();
  });
});
