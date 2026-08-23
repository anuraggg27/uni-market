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

vi.mock("../../apps/web/src/api", () => ({
  api: apiMock,
  clearCsrf: vi.fn(),
  jsonBody: (value: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }),
}));

import { NotificationsPage } from "../../apps/web/src/pages/UserPages";

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
    readAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotificationsPage", () => {
  beforeEach(() => {
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
  });

  it("renders responsive notification rows and keeps both read actions", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Notifications",
      }),
    ).toBeVisible();
    expect(
      await screen.findByRole("link", {
        name: "Open notification: New message",
      }),
    ).toHaveAttribute("href", "/chats/conversation-1");
    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("Read")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Mark New message as read" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/notifications/notification-1/read",
        { method: "PATCH" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/notifications/read-all", {
        method: "POST",
      }),
    );
  });
});
