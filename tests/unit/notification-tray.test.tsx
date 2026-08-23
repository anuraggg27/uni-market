// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../../apps/web/src/api", () => ({ api: apiMock }));

import { NotificationTray } from "../../apps/web/src/components/NotificationTray";

const notifications = [
  {
    id: "notification-1",
    type: "NEW_MESSAGE",
    title: "New message",
    body: "You have a new marketplace message",
    href: "/chats/conversation-1",
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: "notification-2",
    type: "LISTING_APPROVED",
    title: "Listing approved",
    body: "Your listing is now visible",
    href: "/listing/listing-1",
    readAt: null,
    createdAt: new Date(Date.now() - 15 * 60_000).toISOString(),
  },
];

function renderTray() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationTray />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotificationTray", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/notifications") return Promise.resolve(notifications);
      if (
        path === "/api/notifications/read-all" ||
        path === "/api/notifications/notification-1/read"
      )
        return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens from the bell, handles read actions, and closes with Escape", async () => {
    renderTray();
    const bell = await screen.findByRole("button", {
      name: "Notifications, 2 unread",
    });
    fireEvent.click(bell);

    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByText("New message")).toBeVisible();
    expect(screen.getByText("2 unread")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/notifications/read-all", {
        method: "POST",
      }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell).toHaveAttribute("aria-expanded", "false");
    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      { timeout: 500 },
    );

    fireEvent.click(bell);
    expect(await screen.findByRole("dialog")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(bell).toHaveAttribute("aria-expanded", "false");
    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      { timeout: 500 },
    );
  });

  it("marks an unread item read and closes when the item is opened", async () => {
    renderTray();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Notifications, 2 unread",
      }),
    );
    fireEvent.click(await screen.findByRole("link", { name: /New message/ }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/notifications/notification-1/read",
        { method: "PATCH" },
      ),
    );
    expect(
      screen.getByRole("button", { name: "Notifications, 2 unread" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the viewport-safe mobile panel and keeps the full page link", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NotificationTray mobile />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Notifications, 2 unread",
      }),
    );

    expect(await screen.findByRole("dialog")).toHaveClass(
      "fixed",
      "left-3",
      "right-3",
    );
    expect(
      screen.getByRole("link", { name: /View all notifications/ }),
    ).toHaveAttribute("href", "/notifications");
  });
});
