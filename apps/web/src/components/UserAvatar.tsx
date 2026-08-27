import type { CSSProperties } from "react";
import {
  avatars,
  defaultAvatarId,
  type AvatarId,
} from "@campus-market/shared";

type UserAvatarProps = {
  avatarId?: AvatarId | string | null;
  displayName: string;
  size?: number;
  className?: string;
  decorative?: boolean;
};

export function avatarAssetSrc(src: string): string {
  return `${import.meta.env.BASE_URL}${src}`;
}

export function getAvatar(avatarId?: string | null) {
  return avatars.find((avatar) => avatar.id === avatarId)
    ?? avatars.find((avatar) => avatar.id === defaultAvatarId)!;
}

export function UserAvatar({
  avatarId,
  displayName,
  size = 40,
  className = "",
  decorative = false,
}: UserAvatarProps) {
  const configuredAvatar = getAvatar(avatarId);

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${displayName}'s avatar`}
      aria-hidden={decorative || undefined}
      data-avatar-id={configuredAvatar.id}
    >
      <img
        src={avatarAssetSrc(configuredAvatar.src)}
        alt=""
        width={size}
        height={size}
      />
    </span>
  );
}
