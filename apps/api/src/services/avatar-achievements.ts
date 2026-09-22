import { eq } from 'drizzle-orm';
import { avatarAchievementIds, avatars, type AvatarAchievementId, type AvatarId } from '@campus-market/shared';
import type { Database } from '../db/client.js';
import { notifications, userAchievements } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

type AchievementTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const AVATAR_PICKER_HREF = '/profile?avatar=choose';

const notificationBody: Record<AvatarAchievementId, string> = {
  FIRST_LISTING: 'Your first listing unlocked new profile avatars.',
  FIRST_PURCHASE: 'Your first purchase unlocked new profile avatars.',
};

export async function unlockAvatarAchievement(
  tx: AchievementTransaction,
  userId: string,
  achievement: AvatarAchievementId,
): Promise<boolean> {
  const unlocked = (await tx.insert(userAchievements).values({ userId, achievement })
    .onConflictDoNothing()
    .returning({ achievement: userAchievements.achievement }))[0];
  if (!unlocked) return false;
  await tx.insert(notifications).values({
    userId,
    type: 'AVATAR_UNLOCKED',
    title: 'New avatar unlocked ✨',
    body: notificationBody[achievement],
    href: AVATAR_PICKER_HREF,
  });
  return true;
}

export async function getAvatarAchievements(db: Database, userId: string): Promise<AvatarAchievementId[]> {
  const rows = await db.select({ achievement: userAchievements.achievement })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  const unlocked = new Set(rows.map(({ achievement }) => achievement));
  return avatarAchievementIds.filter((achievement) => unlocked.has(achievement));
}

export async function assertAvatarUnlocked(db: Database, userId: string, avatarId: AvatarId): Promise<void> {
  const avatar = avatars.find((entry) => entry.id === avatarId);
  if (!avatar?.achievement) return;
  const unlocked = (await db.select({ achievement: userAchievements.achievement })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId)));
  if (!unlocked.some((entry) => entry.achievement === avatar.achievement)) {
    throw new AppError(403, 'AVATAR_LOCKED', avatar.unlockRequirement ?? 'Complete the achievement to unlock this avatar');
  }
}
