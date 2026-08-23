import {
  AlertTriangle,
  Bell,
  Bookmark,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

export function getNotificationIcon(type: string): LucideIcon {
  if (["NEW_MESSAGE", "NEW_CONVERSATION", "SUPPORT_RESPONSE"].includes(type))
    return MessageCircle;
  if (type === "LISTING_APPROVED") return ShieldCheck;
  if (["REQUEST_ACCEPTED", "TRANSACTION_COMPLETED"].includes(type))
    return CheckCircle2;
  if (type === "LISTING_RESERVED") return Bookmark;
  if (type === "PURCHASE_REQUEST") return ShoppingBag;
  if (type === "REVIEW_RECEIVED") return Star;
  if (
    ["LISTING_REJECTED", "LISTING_REMOVED", "MODERATION_WARNING"].includes(type)
  )
    return AlertTriangle;
  return Bell;
}

export function formatNotificationTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function NotificationTray({ mobile = false }: { mobile?: boolean }) {
  const client = useQueryClient();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationRecord[]>("/api/notifications"),
  });
  const notifications = query.data ?? [];
  const trayNotifications = notifications.slice(0, 7);
  const unreadCount = notifications.filter(
    (notification) => !notification.readAt,
  ).length;

  const close = useCallback(() => {
    setOpen(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setMounted(false), 180);
  }, []);

  function toggle() {
    if (open) {
      close();
      return;
    }
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setMounted(true);
    frameRef.current = window.requestAnimationFrame(() => setOpen(true));
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const read = useMutation({
    mutationFn: (id: string) =>
      api(`/api/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const readAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        className={`relative grid rounded-full text-[#4b5563] transition-colors hover:bg-black/[0.04] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176b45]/30 ${
          mobile ? "size-8" : "size-9"
        }`}
        aria-label={
          unreadCount
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="m-auto size-4" aria-hidden="true" />
        {unreadCount ? (
          <span
            className="absolute right-1.5 top-1.5 size-2 rounded-full border-2 border-white bg-[#176b45]"
            aria-hidden="true"
          />
        ) : null}
      </button>

      {mounted ? (
        <section
          className={`z-50 flex max-h-[min(580px,calc(100vh-84px))] flex-col overflow-hidden rounded-[18px] border border-[#e7e9e8] bg-white shadow-[0_18px_50px_rgba(17,24,39,0.12)] transition duration-[180ms] ease-out motion-reduce:transition-none ${
            mobile
              ? "fixed left-3 right-3 top-[68px]"
              : "absolute right-0 top-[calc(100%+12px)] w-[400px]"
          } ${open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0" }`}
          role="dialog"
          aria-label="Notifications"
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#eef0ef] bg-white px-5 py-4">
            <div>
              <h2 className="m-0 text-[16px] font-semibold tracking-[-0.02em] text-[#111827]">
                Notifications
              </h2>
              {unreadCount ? (
                <p className="mb-0 mt-0.5 text-[11px] text-[#7b8490]">
                  {unreadCount} unread
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-md px-1 py-1 text-[12px] font-medium text-[#176b45] transition-colors hover:text-[#0d4a2e] disabled:cursor-default disabled:text-[#a4aba7]"
              onClick={() => readAll.mutate()}
              disabled={!unreadCount || readAll.isPending}
            >
              Mark all read
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {query.isLoading ? (
              <div className="grid gap-3 p-5" role="status">
                {[0, 1, 2].map((item) => (
                  <span
                    className="h-[72px] animate-pulse rounded-xl bg-[#f4f6f5]"
                    key={item}
                  />
                ))}
                <span className="sr-only">Loading notifications</span>
              </div>
            ) : query.isError ? (
              <div className="px-6 py-10 text-center">
                <p className="m-0 text-sm font-medium text-[#374151]">
                  Could not load notifications
                </p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-[#176b45]"
                  onClick={() => void query.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : !trayNotifications.length ? (
              <div className="grid justify-items-center px-6 py-11 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-[#f2f6f3] text-[#176b45]">
                  <Bell className="size-[18px]" aria-hidden="true" />
                </span>
                <h3 className="mb-0 mt-3 text-sm font-semibold text-[#111827]">
                  You&apos;re all caught up
                </h3>
                <p className="mb-0 mt-1 text-xs text-[#7b8490]">
                  No new notifications right now.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#f0f2f1]">
                {trayNotifications.map((notification) => {
                  const Icon = getNotificationIcon(notification.type);
                  const unread = !notification.readAt;
                  return (
                    <Link
                      to={notification.href}
                      key={notification.id}
                      className={`relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-[#f7f9f7] ${
                        unread ? "bg-[#f5f9f6]" : "bg-white"
                      }`}
                      onClick={() => {
                        if (unread) read.mutate(notification.id);
                        close();
                      }}
                    >
                      <span
                        className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
                          unread
                            ? "bg-[#e7f2eb] text-[#176b45]"
                            : "bg-[#f3f4f4] text-[#6b7280]"
                        }`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <strong className="min-w-0 flex-1 text-[13px] font-semibold leading-5 text-[#20252b]">
                            {notification.title}
                            {unread ? (
                              <span className="sr-only">, unread</span>
                            ) : null}
                          </strong>
                          {unread ? (
                            <span
                              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#176b45]"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.45] text-[#667069]">
                          {notification.body}
                        </span>
                        <time
                          className="mt-1.5 block text-[10px] text-[#929994]"
                          dateTime={notification.createdAt}
                        >
                          {formatNotificationTime(notification.createdAt)}
                        </time>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#eef0ef] bg-white px-2">
            <Link
              to="/notifications"
              onClick={close}
              className="flex min-h-10 items-center justify-center rounded-xl text-[12px] font-semibold text-[#176b45] transition-colors hover:bg-[#f4f8f5]"
            >
              View all notifications <span aria-hidden="true">&nbsp;→</span>
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
