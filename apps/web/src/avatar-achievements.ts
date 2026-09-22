import { toast } from 'sonner';
import type { AvatarAchievementId } from '@campus-market/shared';

const recentlyShownAchievements = new Map<AvatarAchievementId, number>();
const duplicateWindowMs = 5_000;
const descriptions: Record<AvatarAchievementId, string> = {
  FIRST_LISTING: 'You unlocked new avatars for creating your first listing.',
  FIRST_PURCHASE: 'You unlocked new avatars for completing your first purchase.',
};

export function showAvatarUnlockToast(
  achievement: AvatarAchievementId,
  navigate: (path: string) => void,
): void {
  const now = Date.now();
  const lastShownAt = recentlyShownAchievements.get(achievement);
  if (lastShownAt !== undefined && now - lastShownAt < duplicateWindowMs) return;
  recentlyShownAchievements.set(achievement, now);
  toast.success('New avatar unlocked ✨', {
    description: descriptions[achievement],
    action: {
      label: 'Choose avatar',
      onClick: () => navigate('/profile?avatar=choose'),
    },
  });
}
