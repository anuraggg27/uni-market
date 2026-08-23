import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Inbox, LoaderCircle, ShieldCheck } from "lucide-react";
import { safetyReminder } from "@campus-market/shared";
import { ApiError } from "../api";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <div className="skeleton h-44" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : "Something went wrong";
  return (
    <div className="state">
      <AlertCircle aria-hidden="true" />
      <h2>Couldn’t load this</h2>
      <p>{message}</p>
      {retry ? (
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <Inbox aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function SafetyReminder({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`safety ${compact ? "compact" : ""}`}>
      <ShieldCheck aria-hidden="true" />
      <div>
        <strong>Meet safely</strong>
        <p>{safetyReminder}</p>
      </div>
    </aside>
  );
}
export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        children
      )}
    </button>
  );
}
export function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function FieldError({ children }: { children?: ReactNode }) {
  return children ? (
    <p className="field-error" role="alert">
      {children}
    </p>
  ) : null;
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-backdrop" />
        <Dialog.Content
          className="confirm-dialog"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <p className="confirm-warning">
            This action removes the listing from the marketplace and cannot be
            undone from the app.
          </p>
          <div className="confirm-actions">
            <Dialog.Close asChild>
              <button className="button secondary" disabled={pending}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="button danger"
              onClick={onConfirm}
              disabled={pending}
            >
              {pending ? "Deleting..." : "Delete listing"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
