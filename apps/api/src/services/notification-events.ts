import type { Server } from 'socket.io';
import type { AvatarAchievementId } from '@campus-market/shared';

export function notifyChatUnread(io: Server | undefined, userId: string): void {
  io?.of('/notifications').to(`user:${userId}`).emit('chats:updated');
}

export function notifyNotifications(io: Server | undefined, userIds: string[]): void {
  // Send only an invalidation signal. Notification contents are fetched through
  // the authenticated API, including when permissions or sessions have changed.
  for (const userId of new Set(userIds)) {
    io?.of('/notifications').to(`user:${userId}`).emit('notifications:updated');
  }
}

export function notifyAvatarAchievement(io: Server | undefined, userId: string, achievement: AvatarAchievementId): void {
  io?.of('/notifications').to(`user:${userId}`).emit('achievement:unlocked', { achievement });
}
