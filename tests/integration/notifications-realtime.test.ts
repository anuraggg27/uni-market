import { createServer } from 'node:http';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { attachSocket } from '../../apps/api/src/socket';
import { sessions } from '../../apps/api/src/db/schema';
import { login, makeRole, setup } from './helper';
import { notifyAvatarAchievement } from '../../apps/api/src/services/notification-events';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
afterEach(async () => { await ctx?.client.close(); });

describe('private realtime notifications', () => {
  it('notifies unverified users on every tab, syncs read state, and restores delivery after reconnect', async () => {
    const recipient = await login(ctx.app, 'notification-recipient');
    const outsider = await login(ctx.app, 'notification-outsider');
    const moderator = await login(ctx.app, 'notification-moderator');
    await makeRole(ctx.db, moderator.user.id, 'MODERATOR');
    const server = createServer(ctx.app);
    const io = attachSocket(server, ctx.db, ctx.config);
    ctx.app.set('io', io);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const connections = [recipient, recipient, outsider].map((auth) => socketClient(`${origin}/notifications`, {
      extraHeaders: { Cookie: auth.cookie }, transports: ['websocket'], autoConnect: false,
    }));
    const events: unknown[][][] = [[], [], []];
    const achievementEvents: unknown[][] = [[], [], []];
    const connect = (socket: Socket) => new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    try {
      connections.forEach((socket, index) => {
        socket.on('notifications:updated', (...args: unknown[]) => events[index]!.push(args));
        socket.on('achievement:unlocked', (payload: unknown) => achievementEvents[index]!.push(payload));
      });
      await Promise.all(connections.map(connect));
      notifyAvatarAchievement(io, recipient.user.id, 'FIRST_LISTING');
      await expect.poll(() => achievementEvents.slice(0, 2).map((received) => received.length)).toEqual([1, 1]);
      expect(achievementEvents[0]).toEqual([{ achievement: 'FIRST_LISTING' }]);
      expect(achievementEvents[2]).toEqual([]);
      const assertUpdates = async (count: number) => {
        await expect.poll(() => events.slice(0, 2).map((received) => received.length)).toEqual([count, count]);
        expect(events[2]).toEqual([]);
        expect(events[0]).toEqual(Array.from({ length: count }, () => []));
      };
      const warn = () => moderator.agent.post(`/api/admin/users/${recipient.user.id}/warn`)
        .set(moderator.headers).send({ reason: 'Please review your listing details.' }).expect(204);
      await warn();
      await assertUpdates(1);
      const notifications = (await recipient.agent.get('/api/notifications').expect(200)).body.data;
      expect(notifications[0]).toMatchObject({ title: 'Marketplace warning', readAt: null });
      await recipient.agent.patch(`/api/notifications/${notifications[0].id}/read`).set(recipient.headers).expect(200);
      await assertUpdates(2);
      connections[0]!.disconnect();
      await connect(connections[0]!);
      await warn();
      await assertUpdates(3);
      await recipient.agent.post('/api/notifications/read-all').set(recipient.headers).expect(204);
      await assertUpdates(4);
      expect((await recipient.agent.get('/api/notifications')).body.data.every((row: { readAt: string | null }) => row.readAt)).toBe(true);
    } finally {
      connections.forEach((socket) => socket.close());
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects missing, invalid and revoked sessions', async () => {
    const account = await login(ctx.app, 'notification-revoked');
    await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, account.user.id));
    const server = createServer(ctx.app);
    const io = attachSocket(server, ctx.db, ctx.config);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      for (const cookie of ['', 'campus_session=invalid', account.cookie]) {
        const socket = socketClient(`${origin}/notifications`, {
          extraHeaders: { Cookie: cookie }, transports: ['websocket'], autoConnect: false, reconnection: false,
        });
        try {
          const rejected = new Promise<Error>((resolve, reject) => {
            socket.once('connect_error', resolve);
            socket.once('connect', () => reject(new Error('Unexpected authenticated connection')));
          });
          socket.connect();
          expect((await rejected).message).toBe('Authentication required');
        } finally { socket.close(); }
      }
    } finally {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
