import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { Socket } from "socket.io-client";
import type { AvatarAchievementId } from "@campus-market/shared";
import { useAuth } from "../auth";
import { showAvatarUnlockToast } from "../avatar-achievements";

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function NotificationUpdates() {
  const { user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) {
      client.removeQueries({ queryKey: ["notifications"] });
      return;
    }
    let disposed = false;
    let connection: Socket | undefined;
    const refresh = () => {
      if (!disposed) void client.invalidateQueries({ queryKey: ["notifications"] });
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const achievementUnlocked = (payload: { achievement?: AvatarAchievementId }) => {
      if (!payload?.achievement || !["FIRST_LISTING", "FIRST_PURCHASE"].includes(payload.achievement)) return;
      void client.invalidateQueries({ queryKey: ["me"] });
      showAvatarUnlockToast(payload.achievement, navigate);
    };
    // A single subscription serves the desktop bell, mobile bell, and history.
    // Keep the socket bundle out of the initial render for signed-out visitors.
    void import("socket.io-client").then(({ io }) => {
      if (disposed) return;
      connection = io(`${API_URL}/notifications`, { withCredentials: true, autoConnect: false });
      connection.on("connect", refresh);
      connection.on("notifications:updated", refresh);
      connection.on("achievement:unlocked", achievementUnlocked);
      connection.connect();
    }).catch(() => {
      // The visibility check and fallback refresh still work if live updates fail.
    });
    const fallback = window.setInterval(() => {
      if (!connection?.connected) visible();
    }, 15_000);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      disposed = true;
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", visible);
      connection?.off("connect", refresh);
      connection?.off("notifications:updated", refresh);
      connection?.off("achievement:unlocked", achievementUnlocked);
      connection?.disconnect();
    };
  }, [client, navigate, user?.id]);

  return null;
}
