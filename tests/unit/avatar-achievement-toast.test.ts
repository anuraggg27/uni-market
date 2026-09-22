import { beforeEach, describe, expect, it, vi } from 'vitest';

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success } }));

import { showAvatarUnlockToast } from '../../apps/web/src/avatar-achievements';

describe('avatar achievement toast', () => {
  beforeEach(() => success.mockClear());

  it('uses the existing Sonner action pattern to open the avatar picker', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    const navigate = vi.fn();
    showAvatarUnlockToast('FIRST_PURCHASE', navigate);
    expect(success).toHaveBeenCalledWith('New avatar unlocked ✨', expect.objectContaining({
      description: 'You unlocked new avatars for completing your first purchase.',
      action: expect.objectContaining({ label: 'Choose avatar' }),
    }));
    const options = success.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(navigate).toHaveBeenCalledWith('/profile?avatar=choose');

    showAvatarUnlockToast('FIRST_PURCHASE', navigate);
    expect(success).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_001);
    showAvatarUnlockToast('FIRST_PURCHASE', navigate);
    expect(success).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
