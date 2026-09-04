import { parse as parseCookie } from 'cookie';
import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { messageSchema } from '@campus-market/shared';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { academicDomains, blocks, conversations, messageRiskEvents, messages, notifications, policyAcceptances, sessions, users } from './db/schema.js';
import { sha256 } from './lib/crypto.js';
import { logger } from './lib/logger.js';
import { currentPolicyVersion, requiredOnboardingPolicies } from '@campus-market/shared';
import { createScamConfirmation, scamRiskCodes, verifyScamConfirmation } from './services/scam-risk.js';
import { queueUserEmail } from './services/email-preferences.js';
import { notifyNotifications } from './services/notification-events.js';

export function attachSocket(server: HttpServer, db: Database, config: AppConfig): Server {
  const io = new Server(server, { cors: { origin: config.CLIENT_URL, credentials: true }, maxHttpBufferSize: 20_000, transports: ['websocket', 'polling'] });
  const buckets = new Map<string, number[]>();
  // Notifications are available to every signed-in user, independently of
  // the stricter marketplace verification needed for chat and reservations.
  const notificationChannel = io.of('/notifications');
  notificationChannel.use(async (socket, next) => {
    try {
      const raw = parseCookie(socket.handshake.headers.cookie ?? '').campus_session;
      if (!raw) return next(new Error('Authentication required'));
      const [session] = await db.select({ userId: sessions.userId }).from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sha256(`${raw}:${config.SESSION_SECRET}`)),
          gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt),
          isNull(users.closedAt), isNull(users.deletedAt))).limit(1);
      if (!session) return next(new Error('Authentication required'));
      socket.data.userId = session.userId;
      next();
    } catch { next(new Error('Authentication failed')); }
  });
  notificationChannel.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId as string}`);
  });
  io.use(async (socket, next) => {
    try {
      const raw = parseCookie(socket.handshake.headers.cookie ?? '').campus_session;
      if (!raw) return next(new Error('Authentication required'));
      const row = (await db.select({ userId: sessions.userId, suspendedAt: users.suspendedAt, phoneVerifiedAt: users.phoneVerifiedAt, studentEmailDomain: users.studentEmailDomain, studentEmailVerifiedAt: users.studentEmailVerifiedAt, studentEmailExpiresAt: users.studentEmailExpiresAt, adultAttestedAt: users.adultAttestedAt }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, sha256(`${raw}:${config.SESSION_SECRET}`)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt), isNull(users.closedAt))).limit(1))[0];
      if (!row || row.suspendedAt || !row.phoneVerifiedAt || !row.studentEmailDomain || !row.studentEmailVerifiedAt || !row.studentEmailExpiresAt || row.studentEmailExpiresAt <= new Date() || !row.adultAttestedAt) return next(new Error('Account cannot use messaging'));
      const [domain, acceptances] = await Promise.all([
        db.select({ id: academicDomains.id }).from(academicDomains).where(and(eq(academicDomains.domain, row.studentEmailDomain), eq(academicDomains.active, true))).limit(1),
        db.select({ policy: policyAcceptances.policy }).from(policyAcceptances).where(and(eq(policyAcceptances.userId, row.userId), eq(policyAcceptances.version, currentPolicyVersion), inArray(policyAcceptances.policy, [...requiredOnboardingPolicies]))),
      ]);
      if (!domain.length || new Set(acceptances.map(({ policy }) => policy)).size !== requiredOnboardingPolicies.length) return next(new Error('Account cannot use messaging'));
      socket.data.userId = row.userId; next();
    } catch { next(new Error('Authentication failed')); }
  });
  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    // A private user room keeps the inbox live even when no conversation is open.
    // Socket.IO creates a new server-side socket after reconnecting, so joining it
    // here also restores delivery without requiring a page refresh.
    void socket.join(`user:${userId}`);
    socket.on('conversation:subscribe', async (conversationId: unknown, acknowledge?: (result: unknown) => void) => {
      if (typeof conversationId !== 'string') return acknowledge?.({ ok: false });
      const member = (await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)))).limit(1))[0];
      if (!member) return acknowledge?.({ ok: false, error: 'Forbidden' });
      await socket.join(`conversation:${conversationId}`); acknowledge?.({ ok: true });
    });
    socket.on('conversation:read', async (conversationId: unknown, acknowledge?: (result: unknown) => void) => {
      if (typeof conversationId !== 'string') return acknowledge?.({ ok: false });
      const member = (await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)))).limit(1))[0];
      if (!member) return acknowledge?.({ ok: false, error: 'Forbidden' });
      await db.update(messages).set({ readAt: new Date() }).where(and(eq(messages.conversationId, conversationId), ne(messages.senderId, userId), isNull(messages.readAt)));
      acknowledge?.({ ok: true });
    });
    socket.on('message:send', async (payload: unknown, acknowledge?: (result: unknown) => void) => {
      try {
        const parsed = messageSchema.extend({ conversationId: messageSchema.shape.clientId }).parse(payload);
        const now = Date.now(); const recent = (buckets.get(userId) ?? []).filter((value) => now - value < 10_000);
        if (recent.length >= 12) return acknowledge?.({ ok: false, error: 'Rate limited' }); recent.push(now); buckets.set(userId, recent);
        const conversation = (await db.select().from(conversations).where(and(eq(conversations.id, parsed.conversationId), or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)))).limit(1))[0];
        if (!conversation) return acknowledge?.({ ok: false, error: 'Forbidden' });
        const otherId = conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;
        const blocked = (await db.select().from(blocks).where(or(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)), and(eq(blocks.blockerId, otherId), eq(blocks.blockedId, userId)))).limit(1))[0];
        if (blocked) return acknowledge?.({ ok: false, error: 'Blocked' });
        const existing = (await db.select().from(messages).where(and(eq(messages.senderId, userId), eq(messages.clientId, parsed.clientId))).limit(1))[0];
        if (existing) return acknowledge?.({ ok: true, data: existing });
        const riskCodes = scamRiskCodes(parsed.body);
        if (riskCodes.length && !verifyScamConfirmation(parsed.safetyConfirmationToken, userId, parsed.clientId, parsed.body, riskCodes, config.SESSION_SECRET)) return acknowledge?.({ ok: false, warning: { riskCodes, confirmationToken: createScamConfirmation(userId, parsed.clientId, parsed.body, riskCodes, config.SESSION_SECRET) } });
        const created = await db.transaction(async (tx) => {
          const message = (await tx.insert(messages).values({ conversationId: conversation.id, senderId: userId, clientId: parsed.clientId, body: parsed.body }).returning())[0]!;
          if (riskCodes.length) await tx.insert(messageRiskEvents).values({ messageId: message.id, userId, riskCodes, acknowledgedAt: new Date() });
          await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));
          await tx.insert(notifications).values({ userId: otherId, type: 'NEW_MESSAGE', title: 'New message', body: 'You have a new marketplace message', href: `/chats/${conversation.id}` });
          if (!conversation.firstMessageEmailQueuedAt) { await tx.update(conversations).set({ firstMessageEmailQueuedAt: new Date() }).where(and(eq(conversations.id, conversation.id), isNull(conversations.firstMessageEmailQueuedAt))); await queueUserEmail(tx, { recipientUserId: otherId, template: 'first-conversation-message', payload: { conversationId: conversation.id }, dedupeKey: `first-conversation-message:${conversation.id}` }); }
          return message;
        });
        notifyNotifications(io, [otherId]);
        io.to(`conversation:${conversation.id}`)
          .to(`user:${conversation.buyerId}`)
          .to(`user:${conversation.sellerId}`)
          .emit('message:new', created);
        acknowledge?.({ ok: true, data: created });
      } catch (error) { logger.warn({ err: error, userId }, 'socket message rejected'); acknowledge?.({ ok: false, error: 'Invalid message' }); }
    });
    socket.on('listing:watch', async (listingId: unknown) => { if (typeof listingId === 'string') { await socket.join(`listing:${listingId}`); const count = io.sockets.adapter.rooms.get(`listing:${listingId}`)?.size ?? 0; if (count > 1) io.to(`listing:${listingId}`).emit('listing:viewers', { count, approximate: true }); } });
    socket.on('disconnecting', () => { for (const room of socket.rooms) if (room.startsWith('listing:')) { const count = Math.max(0, (io.sockets.adapter.rooms.get(room)?.size ?? 1) - 1); if (count > 1) io.to(room).emit('listing:viewers', { count, approximate: true }); else io.to(room).emit('listing:viewers', { count: 0, approximate: true }); } });
  });
  return io;
}
