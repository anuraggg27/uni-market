import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { loadConfig } from '../../apps/api/src/config';
import { createDatabase } from '../../apps/api/src/db/client';
import * as schema from '../../apps/api/src/db/schema';
import { UnreadReminderJob } from '../../apps/api/src/services/unread-reminders';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
const databaseUrl = process.env.TEST_POSTGRES_URL;

describe.skipIf(!databaseUrl)('reminder delivery on PostgreSQL', () => {
  let database: ReturnType<typeof createDatabase>;
  let control: ReturnType<typeof postgres>;
  let config: ReturnType<typeof loadConfig>;
  let conversationId: string;
  let categoryId: string;
  let listingId: string;
  let userIds: string[];
  const marker = randomUUID();
  const now = new Date('2035-01-01T12:00:00Z');

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/uni_market_retention_test') {
      throw new Error('Use an isolated local uni_market_retention_test database');
    }
    control = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    await migrate(drizzle(control), { migrationsFolder: resolve('apps/api/drizzle') });
    config = loadConfig({ NODE_ENV: 'test', DEV_MODE: 'false', DATABASE_URL: databaseUrl!, SMTP_HOST: 'smtp.example.test' });
    database = createDatabase(config);
    const users = await database.db.insert(schema.users).values([
      { email: `seller-${marker}@example.test`, displayName: 'Seller fixture' },
      { email: `buyer-${marker}@example.test`, displayName: 'Buyer fixture' },
    ]).returning();
    userIds = users.map(user => user.id);
    categoryId = (await database.db.insert(schema.categories).values({ name: `Reminder ${marker}`, slug: `reminder-${marker}` }).returning())[0]!.id;
    listingId = (await database.db.insert(schema.listings).values({ sellerId: userIds[0]!, categoryId, title: 'Reminder fixture',
      description: 'Isolated reminder test', condition: 'GOOD', priceType: 'FREE', location: 'Test campus',
      moderationState: 'APPROVED', lifecycleState: 'ACTIVE' }).returning())[0]!.id;
    conversationId = (await database.db.insert(schema.conversations).values({ sellerId: userIds[0]!, buyerId: userIds[1]!, listingId }).returning())[0]!.id;
    await database.db.insert(schema.messages).values({ conversationId, senderId: userIds[1]!, clientId: randomUUID(),
      body: 'Private fixture', createdAt: new Date(now.getTime() - 6 * 3_600_000) });
    // Prequeue to isolate the SMTP lock from concurrent queue index contention.
    await database.db.insert(schema.emailOutbox).values({ recipientUserId: userIds[0]!, reminderConversationId: conversationId,
      template: 'unread-message-reminder', payload: { conversationId, through: now.toISOString() }, dedupeKey: `reminder-pg:${marker}` });
  });
  afterAll(async () => {
    if (database) {
      await database.db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
      await database.db.delete(schema.listings).where(eq(schema.listings.id, listingId));
      await database.db.delete(schema.categories).where(eq(schema.categories.id, categoryId));
      await database.db.delete(schema.users).where(inArray(schema.users.id, userIds));
      await database.close();
    }
    await control?.end();
  });

  it('holds its lock through SMTP so an independent worker cannot reclaim the in-flight email', async () => {
    let accepted!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { accepted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    sendMail.mockImplementationOnce(async () => { accepted(); await gate; return { messageId: 'accepted' }; });
    const first = new UnreadReminderJob(database.db, config).runOnce(now);
    try {
      await Promise.race([entered, first.then(() => { throw new Error('The first worker did not reach SMTP'); })]);
      const second = await new UnreadReminderJob(database.db, config).runOnce(now);
      expect(second.sent).toBe(0);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const locks = await control<{ count: number }[]>`select count(*)::int as count from pg_locks where locktype = 'transactionid' and granted`;
      expect(locks[0]!.count).toBeGreaterThan(0);
    } finally { release(); }
    expect((await first).sent).toBe(1);
    const [conversation] = await database.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
    expect(conversation?.lastUnreadReminderSentAt).toEqual(now);
    const result = await database.db.select({ count: sql<number>`count(*)` }).from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.reminderConversationId, conversationId));
    expect(Number(result[0]!.count)).toBe(1);
  });
});
