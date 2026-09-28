import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/api/src/config';
import { createDatabase } from '../../apps/api/src/db/client';
import { categories, listings, transactions, users } from '../../apps/api/src/db/schema';
import { errorHandler } from '../../apps/api/src/lib/errors';
import { adminRouter } from '../../apps/api/src/routes/operations';
import { transactionsRouter } from '../../apps/api/src/routes/transactions';
import { StorageService } from '../../apps/api/src/services/storage';

const databaseUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!databaseUrl)('reservation cancellation on real PostgreSQL', () => {
  const marker = randomUUID();
  const applicationName = `reservation-cancel-${marker}`;
  let control: ReturnType<typeof postgres>;
  let connection: ReturnType<typeof createDatabase>;
  let app: express.Express;
  let adminApp: express.Express;
  let listingId: string;
  let transactionId: string;
  let buyerId: string;
  let sellerId: string;
  let categoryId: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/uni_market_retention_test') throw new Error('Use an isolated local uni_market_retention_test database');
    control = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    await migrate(drizzle(control), { migrationsFolder: resolve('apps/api/drizzle') });
    url.searchParams.set('application_name', applicationName);
    const config = loadConfig({
      NODE_ENV: 'test', APP_ENV: 'test', DEV_MODE: 'true', DATABASE_URL: url.href,
      CLIENT_URL: 'http://localhost:5173', API_URL: 'http://localhost:4000',
      SESSION_SECRET: 'reservation-test-session-secret-at-least-32-chars',
      CSRF_SECRET: 'reservation-test-csrf-secret-at-least-32-chars',
    });
    connection = createDatabase(config);
    const [seller, buyer] = await connection.db.insert(users).values([
      { email: `seller-${marker}@example.test`, displayName: 'Seller' },
      { email: `buyer-${marker}@example.test`, displayName: 'Buyer' },
    ]).returning();
    buyerId = buyer!.id;
    sellerId = seller!.id;
    const [category] = await connection.db.insert(categories).values({ name: `Reservation ${marker}`, slug: `reservation-${marker}` }).returning();
    categoryId = category!.id;
    const [listing] = await connection.db.insert(listings).values({
      sellerId: seller!.id, categoryId: category!.id, title: 'Concurrent reservation item',
      description: 'A used item offered in an isolated concurrency test.', condition: 'GOOD',
      priceType: 'FREE', location: 'Test campus', moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date(),
    }).returning();
    listingId = listing!.id;
    const [transaction] = await connection.db.insert(transactions).values({ listingId, sellerId: seller!.id, buyerId }).returning();
    transactionId = transaction!.id;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: buyerId, sessionId: marker, roles: ['USER'], phoneVerified: true, studentEmailVerified: true, adultAttested: true, policiesAccepted: true, marketplaceEligible: true, staffVerified: true, suspended: false };
      next();
    });
    app.use('/api', transactionsRouter(connection.db, config, new StorageService(config)));
    app.use(errorHandler);
    adminApp = express();
    adminApp.use(express.json());
    adminApp.use((req, _res, next) => {
      req.auth = { userId: sellerId, sessionId: marker, roles: ['MODERATOR'], phoneVerified: true, studentEmailVerified: true, adultAttested: true, policiesAccepted: true, marketplaceEligible: true, staffVerified: true, suspended: false };
      next();
    });
    adminApp.use('/api/admin', adminRouter(connection.db, config, new StorageService(config)));
    adminApp.use(errorHandler);
  });
  afterAll(async () => { await connection?.close(); await control?.end(); });

  it('releases a reservation accepted while cancellation waits for the listing lock', async () => {
    let pending: Promise<request.Response> | undefined;
    let response: request.Response | undefined;
    try {
      await control.begin(async (tx) => {
        await tx`SELECT id FROM listings WHERE id = ${listingId} FOR UPDATE`;
        pending = request(app).post(`/api/transactions/${transactionId}/cancel`).then((response) => response);
        await expect.poll(async () => {
          const [row] = await connection.db.select({ blocked: sql<number>`count(*)::int` }).from(sql`pg_stat_activity`).where(sql`application_name = ${applicationName} and wait_event_type = 'Lock'`);
          return row!.blocked;
        }, { timeout: 5000 }).toBe(1);
        await tx`UPDATE listings SET lifecycle_state = 'RESERVED', reserved_buyer_id = ${buyerId} WHERE id = ${listingId}`;
        await tx`UPDATE transactions SET status = 'RESERVED' WHERE id = ${transactionId}`;
      });
    } finally {
      if (pending) response = await pending;
    }
    expect(response?.status).toBe(200);
    const [listing] = await connection.db.select().from(listings).where(eq(listings.id, listingId));
    const [transaction] = await connection.db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(listing).toMatchObject({ lifecycleState: 'ACTIVE', reservedBuyerId: null });
    expect(transaction?.status).toBe('CANCELLED_BY_BUYER');
  });

  it('rejects moderation changes if a listing becomes reserved while the decision waits for its lock', async () => {
    const [listing] = await connection.db.insert(listings).values({
      sellerId, categoryId, title: 'Moderation race item',
      description: 'A used item offered in an isolated concurrency test.', condition: 'GOOD',
      priceType: 'FREE', location: 'Test campus', moderationState: 'APPROVED',
      lifecycleState: 'ACTIVE', approvedAt: new Date(), submittedAt: new Date(),
    }).returning();
    const [transaction] = await connection.db.insert(transactions).values({
      listingId: listing!.id, sellerId, buyerId,
    }).returning();
    let pending: Promise<request.Response> | undefined;
    let response: request.Response | undefined;
    try {
      await control.begin(async (tx) => {
        await tx`SELECT id FROM listings WHERE id = ${listing!.id} FOR UPDATE`;
        pending = request(adminApp).post(`/api/admin/listings/${listing!.id}/decision`).send({
          decision: 'REQUEST_CHANGES', internalReason: 'Image needs replacing',
          userVisibleReason: 'Please replace the listing image',
        }).then((result) => result);
        await expect.poll(async () => {
          const [row] = await connection.db.select({ blocked: sql<number>`count(*)::int` }).from(sql`pg_stat_activity`).where(sql`application_name = ${applicationName} and wait_event_type = 'Lock'`);
          return row!.blocked;
        }, { timeout: 5000 }).toBe(1);
        await tx`UPDATE listings SET lifecycle_state = 'RESERVED', reserved_buyer_id = ${buyerId} WHERE id = ${listing!.id}`;
        await tx`UPDATE transactions SET status = 'RESERVED' WHERE id = ${transaction!.id}`;
      });
    } finally {
      if (pending) response = await pending;
    }
    expect(response?.status).toBe(409);
    expect(response?.body.error.code).toBe('LISTING_LOCKED');
    const [finalListing] = await connection.db.select().from(listings).where(eq(listings.id, listing!.id));
    const [finalTransaction] = await connection.db.select().from(transactions).where(eq(transactions.id, transaction!.id));
    expect(finalListing).toMatchObject({ moderationState: 'APPROVED', lifecycleState: 'RESERVED', reservedBuyerId: buyerId });
    expect(finalTransaction?.status).toBe('RESERVED');
  });
});
