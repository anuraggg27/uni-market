import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Check, LockKeyhole, X } from "lucide-react";
import {
  avatars,
  type AvatarAchievementId,
  type AvatarConfig,
  type AvatarId,
} from "@campus-market/shared";
import { avatarAssetSrc } from "./UserAvatar";

export function AvatarPicker({
  value,
  onChange,
  unlockedAchievements = [],
  label = "Choose your avatar",
}: {
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  unlockedAchievements?: readonly AvatarAchievementId[];
  label?: string;
}) {
  const labelId = useId();
  const [openRequirement, setOpenRequirement] = useState<AvatarId | null>(null);
  const standardAvatars = avatars.filter((avatar) => !avatar.achievement);
  const unlockableAvatars = avatars.filter((avatar) => avatar.achievement);

  const avatarOption = (avatar: AvatarConfig) => {
    const selected = value === avatar.id;
    const locked = Boolean(avatar.achievement && !unlockedAchievements.includes(avatar.achievement));
    const requirementId = `${labelId}-${avatar.id}-requirement`;
    return (
      <button
        key={avatar.id}
        type="button"
        className="avatar-picker-option"
        role="radio"
        aria-checked={selected}
        aria-disabled={locked || undefined}
        aria-describedby={locked ? requirementId : undefined}
        aria-label={locked ? `${avatar.name} avatar, locked` : `Select ${avatar.name} avatar`}
        data-selected={selected || undefined}
        data-locked={locked || undefined}
        data-requirement-open={locked && openRequirement === avatar.id || undefined}
        onClick={() => {
          if (locked) {
            setOpenRequirement((current) => current === avatar.id ? null : avatar.id);
            return;
          }
          setOpenRequirement(null);
          onChange(avatar.id);
        }}
      >
        <span className="avatar-picker-portrait">
          <img
            src={avatarAssetSrc(avatar.src)}
            alt=""
            width={160}
            height={160}
            loading="lazy"
          />
          {locked ? (
            <span className="avatar-picker-lock" aria-hidden="true">
              <LockKeyhole />
            </span>
          ) : null}
        </span>
        {locked ? (
          <span id={requirementId} className="avatar-picker-lock-tooltip" role="tooltip">
            {avatar.unlockRequirement}
          </span>
        ) : null}
        {selected && !locked ? (
          <span className="avatar-picker-check" aria-hidden="true">
            <Check />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <section className="avatar-picker">
      <div className="avatar-picker-heading">
        <h2 id={labelId}>{label}</h2>
        <p>Pick an illustration that feels like you.</p>
      </div>
      <div className="avatar-picker-groups" role="radiogroup" aria-labelledby={labelId}>
        <div className="avatar-picker-grid">
          {standardAvatars.map(avatarOption)}
        </div>
        <div className="avatar-picker-unlock-heading">
          <span>Unlockable <span aria-hidden="true">&#10022;</span></span>
        </div>
        <div className="avatar-picker-grid avatar-picker-unlock-grid">
          {unlockableAvatars.map(avatarOption)}
        </div>
      </div>
    </section>
  );
}

export function AvatarPickerDialog({
  open,
  value,
  onChange,
  onClose,
  onSave,
  pending,
  error,
  unlockedAchievements = [],
}: {
  open: boolean;
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  onClose: () => void;
  onSave: () => void;
  pending?: boolean;
  error?: string | undefined;
  unlockedAchievements?: readonly AvatarAchievementId[];
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") trapFocus(event, dialogRef);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="avatar-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="avatar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="avatar-dialog-header">
          <div>
            <h2 id={titleId}>Change avatar</h2>
            <p>Your avatar appears across Uni Market.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="avatar-dialog-close"
            onClick={onClose}
            aria-label="Close avatar picker"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="avatar-dialog-body">
          <AvatarPicker value={value} onChange={onChange} unlockedAchievements={unlockedAchievements} label="Choose a new avatar" />
        </div>
        <div className="avatar-dialog-footer">
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <button type="button" className="button secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={onSave} disabled={pending}>
            {pending ? "Saving..." : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function trapFocus(
  event: KeyboardEvent,
  dialogRef: RefObject<HTMLDivElement | null>,
) {
  const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
