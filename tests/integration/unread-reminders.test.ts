import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as socketClient } from 'socket.io-client';
import { eq, sql } from 'drizzle-orm';
import { UnreadReminderJob } from '../../apps/api/src/services/unread-reminders';
import { EmailWorker } from '../../apps/api/src/services/email';
import * as schema from '../../apps/api/src/db/schema';
import { login, setup } from './helper';
import { attachSocket } from '../../apps/api/src/socket';
import { directEmailJob } from '../../apps/api/src/services/email-outbox';
import { decryptText } from '../../apps/api/src/lib/crypto';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const now = new Date('2035-01-01T12:00:00Z');
const hours = (offset: number) => new Date(now.getTime() + offset * 3_600_000);
let ctx: Awaited<ReturnType<typeof setup>>;
let sellerId: string;
let buyerId: string;
let listingId: string;
let conversationId: string;
const config = () => ({ ...ctx.config, DEV_MODE: false, SMTP_HOST: 'smtp.example.test', CLIENT_URL: 'https://uni.rocks' });
const run = (clock = now) => new UnreadReminderJob(ctx.db, config()).runOnce(clock);
const jobs = () => ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.template, 'unread-message-reminder'));
const incoming = async (age = -6, extra: Partial<typeof schema.messages.$inferInsert> = {}) =>
  (await ctx.db.insert(schema.messages).values({ conversationId, senderId: buyerId, clientId: crypto.randomUUID(), body: 'Private message, never in email', createdAt: hours(age), ...extra }).returning())[0]!;

beforeEach(async () => {
  ctx = await setup();
  sendMail.mockReset().mockResolvedValue({ messageId: 'accepted' });
  const people = await ctx.db.insert(schema.users).values([
    { email: 'seller@example.edu', displayName: 'Seller' }, { email: 'buyer@example.edu', displayName: 'Buyer' },
  ]).returning();
  sellerId = people[0]!.id;
  buyerId = people[1]!.id;
  listingId = (await ctx.db.insert(schema.listings).values({ sellerId, categoryId: ctx.category.id,
    title: 'Desk lamp <special>', description: 'Test listing', condition: 'GOOD', priceType: 'FREE', location: 'Library',
    moderationState: 'APPROVED', lifecycleState: 'ACTIVE' }).returning())[0]!.id;
  conversationId = (await ctx.db.insert(schema.conversations).values({ listingId, sellerId, buyerId }).returning())[0]!.id;
});
afterEach(async () => { vi.restoreAllMocks(); await ctx?.client.close(); });

describe('durable unread reminders', () => {
  it('persists reminder metadata in the actual payload column and delivers the reloaded snapshot', async () => {
    const columns = await ctx.client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'email_outbox' and column_name in ('payload', 'encrypted_payload') order by column_name",
    );
    expect(columns.rows).toEqual([
      { column_name: 'encrypted_payload', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO' },
    ]);
    await incoming();
    expect(await new UnreadReminderJob(ctx.db, config()).runOnce(now, { queueOnly: true, conversationId }))
      .toMatchObject({ queued: 1, pending: 1, sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();

    const [queued] = await jobs();
    const expectedClock = await ctx.client.query<{ through: string }>('select $1::timestamptz::text as through', [now.toISOString()]);
    const expected = { conversationId, listingTitle: 'Desk lamp <special>', through: expectedClock.rows[0]!.through };
    expect(queued!.payload).toEqual(expected);
    expect(queued!.encryptedPayload).toBeNull();
    const raw = await ctx.client.query<{ payload: Record<string, unknown>; encrypted_payload: string | null }>(
      'select payload, encrypted_payload from email_outbox where id = $1', [queued!.id],
    );
    expect(raw.rows).toEqual([{ payload: expected, encrypted_payload: null }]);
    expect(JSON.stringify(raw.rows)).not.toContain('Private message, never in email');
    expect(JSON.stringify(raw.rows)).not.toContain('seller@example.edu');

    // A new worker instance receives no in-memory payload: it must load the
    // persisted snapshot and still pass eligibility/read revalidation to send.
    expect(await new UnreadReminderJob(ctx.db, config()).runOnce(now, { conversationId })).toMatchObject({ sent: 1 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      to: 'seller@example.edu', text: expect.stringContaining(`/marketplace/chats/${conversationId}`),
      html: expect.stringContaining('Desk lamp &lt;special&gt;'),
    });
    expect((await jobs())[0]).toMatchObject({ id: queued!.id, payload: expected, encryptedPayload: null, sentAt: now });
    const marker = await ctx.client.query<{ matches: boolean }>(
      'select last_unread_reminder_through_at = $1::timestamptz as matches from conversations where id = $2',
      [expected.through, conversationId],
    );
    expect(marker.rows[0]!.matches).toBe(true);
  });

  it('keeps sensitive direct-email values encrypted using the established outbox helpers', async () => {
    const input = { recipientEmail: 'controlled@example.test', template: 'grievance-received',
      payload: { reference: 'TEST-OUTBOX-REFERENCE', trackingSecret: 'synthetic-private-tracking-secret' },
      dedupeKey: 'payload-encryption-convention' };
    const [queued] = await ctx.db.insert(schema.emailOutbox).values(directEmailJob(config(), input)).returning();
    const [reloaded] = await ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, queued!.id));
    expect(reloaded!.payload).toEqual({});
    expect(reloaded!.recipientUserId).toBeNull();
    expect(reloaded!.recipientEmailCiphertext).not.toContain(input.recipientEmail);
    expect(reloaded!.encryptedPayload).not.toContain(input.payload.trackingSecret);
    expect(JSON.parse(decryptText(reloaded!.encryptedPayload!, config().DATA_ENCRYPTION_KEY))).toEqual(input.payload);
    expect(decryptText(reloaded!.recipientEmailCiphertext!, config().DATA_ENCRYPTION_KEY)).toBe(input.recipientEmail);
    await new EmailWorker(ctx.db, config()).runOnce();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      to: input.recipientEmail, text: expect.stringContaining(input.payload.trackingSecret),
    });
    const [delivered] = await ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, queued!.id));
    expect(delivered!.sentAt).toBeInstanceOf(Date);
    expect(delivered!.encryptedPayload).toBe(reloaded!.encryptedPayload);
  });

  it('queues only a controlled eligible conversation and suppresses it after read without SMTP', async () => {
    const seller = await login(ctx.app, 'persisted-read-seller');
    sellerId = seller.user.id;
    await ctx.db.update(schema.conversations).set({ sellerId }).where(eq(schema.conversations.id, conversationId));
    await ctx.db.update(schema.listings).set({ sellerId }).where(eq(schema.listings.id, listingId));
    await incoming();
    const job = new UnreadReminderJob(ctx.db, config());
    expect(await job.runOnce(now, { queueOnly: true, conversationId })).toMatchObject({ queued: 1, pending: 1, sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    const [persisted] = await jobs();
    expect(persisted!.payload).toMatchObject({ conversationId, through: expect.any(String), listingTitle: 'Desk lamp <special>' });
    await seller.agent.get(`/api/conversations/${conversationId}/messages`).expect(200);
    expect(await new UnreadReminderJob(ctx.db, config()).runOnce(now, { conversationId })).toMatchObject({ skipped: 1, sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({ id: persisted!.id, payload: persisted!.payload, encryptedPayload: null,
      attempts: 0, sentAt: null, suppressionReason: 'reminder:no-longer-eligible' });
    await expect(job.runOnce(now, { queueOnly: true })).rejects.toThrow('requires a conversation');
  });
  it('previews candidates and due retries without mutating state or sending email', async () => {
    await incoming();
    const job = new UnreadReminderJob(ctx.db, config());
    expect(await job.runOnce(now, { dryRun: true })).toMatchObject({ evaluated: 1, pending: 0, queued: 0, sent: 0 });
    expect(await jobs()).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
    sendMail.mockRejectedValueOnce(new Error('Retry later'));
    await run();
    const before = await jobs();
    expect(await job.runOnce(hours(1), { dryRun: true })).toMatchObject({ evaluated: 0, pending: 1, queued: 0, sent: 0 });
    expect(await jobs()).toEqual(before);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('targets only the selected conversation for scheduling and delivery', async () => {
    await incoming();
    const [otherBuyer] = await ctx.db.insert(schema.users).values({ email: 'other-buyer@example.edu', displayName: 'Other buyer' }).returning();
    const [otherConversation] = await ctx.db.insert(schema.conversations).values({ listingId, sellerId, buyerId: otherBuyer!.id }).returning();
    await incoming(-7, { conversationId: otherConversation!.id, senderId: otherBuyer!.id });
    await ctx.db.insert(schema.emailOutbox).values({ recipientUserId: sellerId, reminderConversationId: otherConversation!.id,
      template: 'unread-message-reminder', payload: { through: now.toISOString() }, dedupeKey: 'other-pending-cycle' });
    expect(await new UnreadReminderJob(ctx.db, config()).runOnce(now, { conversationId })).toMatchObject({ sent: 1, queued: 1 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0].text).toContain(`/chats/${conversationId}`);
    expect((await jobs()).find(job => job.reminderConversationId === otherConversation!.id)?.attempts).toBe(0);
  });

  it('preserves microsecond snapshot precision so covered messages cannot start another cycle', async () => {
    await incoming();
    const newer = await incoming(0);
    await ctx.db.update(schema.messages).set({ createdAt: sql`'2035-01-01T12:00:00.123400Z'::timestamptz` }).where(eq(schema.messages.id, newer.id));
    await ctx.db.insert(schema.emailOutbox).values({ recipientUserId: sellerId, reminderConversationId: conversationId,
      template: 'unread-message-reminder', payload: { through: '2035-01-01T12:00:00.123456Z' }, dedupeKey: 'microsecond-cycle' });
    expect((await run(hours(1))).sent).toBe(1);
    expect((await run(hours(30))).sent).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [row] = await ctx.db.select({ through: sql<string>`last_unread_reminder_through_at::text` }).from(schema.conversations);
    expect(row!.through).toContain('.123456');
  });

  it('fails visibly when reminder delivery is disabled or the target is malformed', async () => {
    await incoming();
    await expect(new UnreadReminderJob(ctx.db, { ...config(), SMTP_HOST: '' }).runOnce(now)).rejects.toThrow('require SMTP');
    await expect(new UnreadReminderJob(ctx.db, config()).runOnce(now, { conversationId: 'invalid' })).rejects.toThrow();
    expect(await jobs()).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('delivers exactly at five hours, with safe listing text, preferences and the direct conversation URL', async () => {
    await incoming(-5);
    expect((await run()).sent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0];
    expect(mail.subject).toBe('Someone might be waiting for your reply 👀');
    expect(mail.text).toContain('Desk lamp <special>');
    expect(mail.html).toContain('Desk lamp &lt;special&gt;');
    expect(mail.html).toContain(`https://uni.rocks/marketplace/chats/${conversationId}`);
    expect(mail.text).toContain('/marketplace/settings?section=email');
    expect(mail.text).not.toContain('Private message');
    expect((await jobs())[0]).toMatchObject({ attempts: 1, sentAt: now, failedAt: null });
  });

  it('waits until five hours and never reminds for seller-authored messages', async () => {
    await incoming(-4.99);
    await incoming(-10, { senderId: sellerId });
    expect((await run()).sent).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
    expect((await run(hours(0.01))).sent).toBe(1);
  });

  it('skips messages read or deleted before the check', async () => {
    await incoming(-8, { readAt: hours(-1) });
    await incoming(-9, { deletedAt: hours(-1) });
    expect((await run()).queued).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('revalidates a read between scheduling and delivery', async () => {
    await incoming();
    const transaction = ctx.db.transaction.bind(ctx.db);
    vi.spyOn(ctx.db, 'transaction').mockImplementationOnce(async (operation: any) => {
      await ctx.db.update(schema.messages).set({ readAt: now }).where(eq(schema.messages.conversationId, conversationId));
      return transaction(operation);
    });
    expect(await run()).toMatchObject({ queued: 1, skipped: 1, sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    expect((await jobs())[0]?.suppressedAt).toEqual(now);
  });

  it('groups several unread messages and never repeats the unchanged state, even after restart or cooldown', async () => {
    await incoming(-12); await incoming(-7); await incoming(-1);
    expect((await run()).sent).toBe(1);
    expect((await run(hours(25))).sent).toBe(0);
    expect(await jobs()).toHaveLength(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [conversation] = await ctx.db.select().from(schema.conversations);
    expect(conversation?.lastUnreadReminderThroughAt).toEqual(now);
  });

  it('allows only new messages after five hours AND the 24-hour cooldown', async () => {
    await incoming(); await run();
    await incoming(1);
    expect((await run(hours(6))).sent).toBe(0);
    expect((await run(hours(23.99))).sent).toBe(0);
    expect((await run(hours(24))).sent).toBe(1);
    await incoming(25);
    expect((await run(hours(48))).sent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('does not let the age of previously reminded messages qualify a fresh message early', async () => {
    await incoming(); await run();
    await incoming(24);
    expect((await run(hours(28.99))).sent).toBe(0);
    expect((await run(hours(29))).sent).toBe(1);
  });

  it('records a failure and retries the same durable job with a stable Message-ID after restart', async () => {
    await incoming();
    sendMail.mockRejectedValueOnce(new Error('Temporary provider error with private address'));
    expect((await run()).failed).toBe(1);
    const [failed] = await jobs();
    expect(failed).toMatchObject({ attempts: 1, lastAttemptAt: now, sentAt: null, lastError: 'SMTP delivery failed' });
    const before = await ctx.client.query<{ payload: Record<string, unknown>; encrypted_payload: string | null }>(
      'select payload, encrypted_payload from email_outbox where id = $1', [failed!.id],
    );
    expect(before.rows[0]!.payload).toMatchObject({ conversationId, listingTitle: 'Desk lamp <special>', through: expect.any(String) });
    expect((await run(hours(0.01))).sent).toBe(0);
    expect((await run(hours(0.1))).sent).toBe(1);
    expect(await jobs()).toHaveLength(1);
    expect(sendMail.mock.calls[0]![0].messageId).toBe(sendMail.mock.calls[1]![0].messageId);
    expect((await jobs())[0]).toMatchObject({ id: failed!.id, dedupeKey: failed!.dedupeKey,
      payload: failed!.payload, encryptedPayload: null, attempts: 2, sentAt: hours(0.1) });
    const after = await ctx.client.query<{ payload: Record<string, unknown>; encrypted_payload: string | null }>(
      'select payload, encrypted_payload from email_outbox where id = $1', [failed!.id],
    );
    expect(after.rows).toEqual(before.rows);
    const marker = await ctx.client.query<{ matches: boolean }>(
      'select last_unread_reminder_through_at = $1::timestamptz as matches from conversations where id = $2',
      [String(before.rows[0]!.payload.through), conversationId],
    );
    expect(marker.rows[0]!.matches).toBe(true);
  });

  it('stops automatic retries after five failed attempts and does not recreate the same cycle', async () => {
    await incoming(); sendMail.mockRejectedValue(new Error('Unavailable'));
    for (let hour = 0; hour < 6; hour++) await run(hours(hour));
    expect(sendMail).toHaveBeenCalledTimes(5);
    expect((await jobs())[0]?.failedAt).toEqual(hours(4));
    expect(await jobs()).toHaveLength(1);
  });

  it('claims only once across concurrent schedulers', async () => {
    await incoming();
    await Promise.all([run(), run(), run()]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await jobs()).toHaveLength(1);
  });

  it.each(['enabled', 'messageUpdates'] as const)('respects the %s email preference', async (preference) => {
    await incoming();
    await ctx.db.insert(schema.emailPreferences).values({ userId: sellerId, [preference]: false });
    expect((await run()).queued).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('suppresses a queued retry when the seller opts out or reads before retrying', async () => {
    await incoming(); sendMail.mockRejectedValueOnce(new Error('Retry later')); await run();
    await ctx.db.insert(schema.emailPreferences).values({ userId: sellerId, messageUpdates: false });
    expect((await run(hours(1))).skipped).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it.each(['deletedAt', 'closedAt', 'suspendedAt'] as const)('skips accounts with %s set', async (field) => {
    await incoming();
    await ctx.db.update(schema.users).set({ [field]: now }).where(eq(schema.users.id, sellerId));
    expect((await run()).sent).toBe(0);
  });

  it('skips blocked participants, invalid email addresses and deleted listings', async () => {
    await incoming();
    await ctx.db.insert(schema.blocks).values({ blockerId: sellerId, blockedId: buyerId });
    expect((await run()).sent).toBe(0);
    await ctx.db.delete(schema.blocks);
    await ctx.db.update(schema.users).set({ email: 'invalid' }).where(eq(schema.users.id, sellerId));
    expect((await run()).sent).toBe(0);
    await ctx.db.update(schema.users).set({ email: 'seller@example.edu' }).where(eq(schema.users.id, sellerId));
    await ctx.db.update(schema.listings).set({ deletedAt: now }).where(eq(schema.listings.id, listingId));
    expect((await run()).sent).toBe(0);
  });

  it('safely removes pending reminders if their conversation is deleted', async () => {
    await incoming(); sendMail.mockRejectedValueOnce(new Error('Retry later')); await run();
    await ctx.db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    expect((await run(hours(1))).sent).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });

  it('keeps the normal email worker from bypassing reminder revalidation', async () => {
    await incoming(); sendMail.mockRejectedValueOnce(new Error('Retry later')); await run();
    await ctx.db.update(schema.emailOutbox).set({ availableAt: new Date(0) });
    await new EmailWorker(ctx.db, config()).runOnce();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('scopes unread conversation counts, ignores deleted messages and clears them on opening', async () => {
    const seller = await login(ctx.app, 'unread-count-seller');
    const buyer = await login(ctx.app, 'unread-count-buyer');
    const outsider = await login(ctx.app, 'unread-count-other');
    await ctx.db.update(schema.conversations).set({ sellerId: seller.user.id, buyerId: buyer.user.id });
    sellerId = seller.user.id; buyerId = buyer.user.id;
    await incoming(); await incoming(-7); await incoming(-8, { deletedAt: now });
    expect((await seller.agent.get('/api/conversations/unread-count').expect(200)).body.data.count).toBe(1);
    expect((await buyer.agent.get('/api/conversations/unread-count').expect(200)).body.data.count).toBe(0);
    expect((await outsider.agent.get('/api/conversations/unread-count').expect(200)).body.data.count).toBe(0);
    await outsider.agent.get(`/api/conversations/${conversationId}/messages`).expect(403);
    await seller.agent.get(`/api/conversations/${conversationId}/messages`).expect(200);
    expect((await seller.agent.get('/api/conversations/unread-count').expect(200)).body.data.count).toBe(0);
    expect((await run()).sent).toBe(0);
  });

  it('syncs read state on the private notifications channel without notifying another account', async () => {
    const seller = await login(ctx.app, 'read-signal-seller');
    const outsider = await login(ctx.app, 'read-signal-outsider');
    await ctx.db.update(schema.conversations).set({ sellerId: seller.user.id });
    await incoming();
    const server = createServer(ctx.app);
    const io = attachSocket(server, ctx.db, ctx.config);
    ctx.app.set('io', io);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const peers = [seller, seller, outsider].map(auth => socketClient(`${origin}/notifications`, {
      extraHeaders: { Cookie: auth.cookie }, transports: ['websocket'], autoConnect: false,
    }));
    const signals = [0, 0, 0];
    try {
      peers.forEach((peer, i) => peer.on('chats:updated', () => { signals[i] = signals[i]! + 1; }));
      await Promise.all(peers.map(peer => new Promise<void>((resolve, reject) => {
        peer.once('connect', resolve); peer.once('connect_error', reject); peer.connect();
      })));
      await seller.agent.get(`/api/conversations/${conversationId}/messages`).expect(200);
      await expect.poll(() => signals).toEqual([1, 1, 0]);
      expect((await seller.agent.get('/api/conversations/unread-count')).body.data.count).toBe(0);
    } finally {
      peers.forEach(peer => peer.close());
      await new Promise<void>(resolve => io.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
