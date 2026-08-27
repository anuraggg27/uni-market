import { useEffect, useId, useRef, type RefObject } from "react";
import { Check, X } from "lucide-react";
import {
  avatars,
  type AvatarId,
} from "@campus-market/shared";
import { avatarAssetSrc } from "./UserAvatar";

export function AvatarPicker({
  value,
  onChange,
  label = "Choose your avatar",
}: {
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  label?: string;
}) {
  const labelId = useId();

  return (
    <section className="avatar-picker">
      <div className="avatar-picker-heading">
        <h2 id={labelId}>{label}</h2>
        <p>Pick an illustration that feels like you.</p>
      </div>
      <div className="avatar-picker-grid" role="radiogroup" aria-labelledby={labelId}>
        {avatars.map((avatar) => {
          const selected = value === avatar.id;
          return (
            <button
              key={avatar.id}
              type="button"
              className="avatar-picker-option"
              role="radio"
              aria-checked={selected}
              aria-label={`Select ${avatar.name} avatar`}
              data-selected={selected || undefined}
              onClick={() => onChange(avatar.id)}
            >
              <span className="avatar-picker-portrait">
                <img
                  src={avatarAssetSrc(avatar.src)}
                  alt=""
                  width={160}
                  height={160}
                  loading="lazy"
                />
              </span>
              {selected ? (
                <span className="avatar-picker-check" aria-hidden="true">
                  <Check />
                </span>
              ) : null}
            </button>
          );
        })}
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
}: {
  open: boolean;
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  onClose: () => void;
  onSave: () => void;
  pending?: boolean;
  error?: string | undefined;
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
          <AvatarPicker value={value} onChange={onChange} label="Choose a new avatar" />
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
