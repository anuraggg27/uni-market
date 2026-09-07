import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../apps/api/src/config';
import { createDatabase } from '../../apps/api/src/db/client';
import { categories, listingImages, listings, users } from '../../apps/api/src/db/schema';
import { errorHandler } from '../../apps/api/src/lib/errors';
import { uploadsRouter } from '../../apps/api/src/routes/uploads';
import { StorageService } from '../../apps/api/src/services/storage';

// Reuse CI's disposable database only. Never accept a deployed database URL.
const databaseUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!databaseUrl)('upload allocation on real PostgreSQL', () => {
  const marker = randomUUID();
  const applicationName = `upload-regression-${marker}`;
  let connection: ReturnType<typeof createDatabase>;
  let control: ReturnType<typeof postgres>;
  let app: express.Express;
  let storage: StorageService;
  let sellerId: string;
  let categoryId: string;
  let listingId: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/uni_market_retention_test') throw new Error('Use an isolated local uni_market_retention_test database');
    control = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    await migrate(drizzle(control), { migrationsFolder: resolve('apps/api/drizzle') });
    url.searchParams.set('application_name', applicationName);
    const config = loadConfig({ NODE_ENV: 'test', APP_ENV: 'test', DEV_MODE: 'true',
      CLIENT_URL: 'http://localhost:5173', API_URL: 'http://localhost:4000', DATABASE_URL: url.href,
      SESSION_SECRET: 'upload-test-session-secret-at-least-32-chars', CSRF_SECRET: 'upload-test-csrf-secret-at-least-32-chars',
    });
    connection = createDatabase(config);
    const [seller] = await connection.db.insert(users).values({ email: `uploads-${marker}@example.test`, displayName: 'Upload fixture' }).returning();
    sellerId = seller!.id;
    const [category] = await connection.db.insert(categories).values({ name: `Upload fixtures ${marker}`, slug: `uploads-${marker}` }).returning();
    categoryId = category!.id;
    storage = new StorageService(config);
    // Exercise the real router and production database adapter. Authentication
    // and CSRF are covered separately by the full-app integration suite.
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: sellerId, sessionId: marker, roles: ['USER'], phoneVerified: true, studentEmailVerified: true, adultAttested: true, policiesAccepted: true, marketplaceEligible: true, staffVerified: true, suspended: false };
      next();
    });
    app.use('/api', uploadsRouter(connection.db, config, storage));
    app.use(errorHandler);
  });
  beforeEach(async () => {
    const [listing] = await connection.db.insert(listings).values({ sellerId, categoryId, title: 'Upload test listing', description: 'Isolated upload allocation fixture.', condition: 'GOOD', priceType: 'FREE', location: 'Test campus' }).returning();
    listingId = listing!.id;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await connection?.close(); await control?.end(); });

  const presign = (id = listingId) => request(app).post(`/api/uploads/listings/${id}/presign`).send({ mimeType: 'image/jpeg', byteSize: 100 });
  const images = () => connection.db.select().from(listingImages).where(eq(listingImages.listingId, listingId)).orderBy(listingImages.position);
  const seed = (positions: number[], deleted = false) => connection.db.insert(listingImages).values(positions.map(position => ({ listingId, ownerId: sellerId, position, mimeType: 'image/jpeg', byteSize: 100, deletedAt: deleted ? new Date() : null })));

  async function competingRequests(count: number) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = storage.createUploadTicket.bind(storage);
    const sign = vi.spyOn(storage, 'createUploadTicket').mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });
    // Hold the first request at signing until every competing connection is
    // actually waiting for its row lock. No timing-dependent sleep or mock DB.
    const pending = Promise.all(Array.from({ length: count }, () => presign().then(response => response)));
    let results;
    try {
      await expect.poll(() => sign.mock.calls.length).toBeGreaterThan(0);
      await expect.poll(async () => {
        const [row] = await control`SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE application_name = ${applicationName} AND wait_event_type = 'Lock'`;
        return row!.blocked;
      }, { timeout: 5000 }).toBe(count - 1);
      expect(sign).toHaveBeenCalledTimes(1);
    } finally {
      release();
      results = await pending;
    }
    return results;
  }

  it('recovers the production case: a deleted first photo must not reserve position zero again', async () => {
    await seed([0], true);
    await presign().expect(201);
    const rows = await images();
    expect(rows.map(row => row.position)).toEqual([0, 1]);
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(rows[1]!.deletedAt).toBeNull();
  });

  it('serializes simultaneous uploads to one listing across database connections', async () => {
    const responses = await competingRequests(6);
    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(responses.map(response => response.body.data.imageId)).size).toBe(6);
    expect((await images()).map(row => row.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('allows exactly one concurrent request for the last slot without exceeding the limit', async () => {
    await seed([0], true);
    await seed([1, 2, 3, 4, 5, 6, 7]);
    const responses = await competingRequests(4);
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 400).map(response => response.body.error.code)).toEqual(['IMAGE_LIMIT_REACHED', 'IMAGE_LIMIT_REACHED', 'IMAGE_LIMIT_REACHED']);
    const active = (await images()).filter(row => !row.deletedAt);
    expect(active).toHaveLength(8);
    expect(active.at(-1)!.position).toBe(8);
  });

  it('rolls back a signing failure and releases the row lock for retry', async () => {
    vi.spyOn(storage, 'createUploadTicket').mockRejectedValueOnce(new Error('Simulated signing failure'));
    await presign().expect(500);
    expect(await images()).toHaveLength(0);
    await presign().expect(201);
    expect((await images()).map(row => row.position)).toEqual([0]);
  });

  it('does not block uploads to another listing while one listing is locked', async () => {
    const [other] = await connection.db.insert(listings).values({ sellerId, categoryId, title: 'Independent listing', description: 'Another isolated upload fixture.', condition: 'GOOD', priceType: 'FREE', location: 'Test campus' }).returning();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = storage.createUploadTicket.bind(storage);
    const sign = vi.spyOn(storage, 'createUploadTicket').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    const pending = presign().then(response => response);
    try {
      await expect.poll(() => sign.mock.calls.length).toBe(1);
      await presign(other!.id).timeout(3000).expect(201);
    } finally {
      release();
      expect((await pending).status).toBe(201);
    }
  });

  it('rechecks listing availability after waiting for a concurrent state change', async () => {
    let pending: Promise<request.Response> | undefined;
    let response: request.Response | undefined;
    try {
      await control.begin(async tx => {
        await tx`SELECT id FROM listings WHERE id = ${listingId} FOR UPDATE`;
        pending = presign().then(result => result);
        await expect.poll(async () => {
          const [row] = await connection.db.select({ blocked: sql<number>`count(*)::int` }).from(sql`pg_stat_activity`).where(sql`application_name = ${applicationName} and wait_event_type = 'Lock'`);
          return row!.blocked;
        }, { timeout: 5000 }).toBe(1);
        await tx`UPDATE listings SET lifecycle_state = 'SOLD' WHERE id = ${listingId}`;
      });
    } finally {
      response = await pending;
    }
    expect(response!.status).toBe(409);
    expect(response!.body.error.code).toBe('LISTING_LOCKED');
    expect(await images()).toHaveLength(0);
  });

  it.each(['SOLD', 'RESERVED'])('preserves the %s listing guard without allocating a slot', async lifecycleState => {
    await connection.db.update(listings).set({ lifecycleState }).where(eq(listings.id, listingId));
    const response = await presign().expect(409);
    expect(response.body.error.code).toBe('LISTING_LOCKED');
    expect(await images()).toHaveLength(0);
  });
});
