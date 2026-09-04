import type { Server } from 'socket.io';

export function notifyNotifications(io: Server | undefined, userIds: string[]): void {
  // Send only an invalidation signal. Notification contents are fetched through
  // the authenticated API, including when permissions or sessions have changed.
  for (const userId of new Set(userIds)) {
    io?.of('/notifications').to(`user:${userId}`).emit('notifications:updated');
  }
}
