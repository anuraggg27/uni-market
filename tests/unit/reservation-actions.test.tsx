// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const { apiMock, realtime } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  realtime: { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
}));
vi.mock("socket.io-client", () => ({ io: () => realtime }));
vi.mock("../../apps/web/src/auth", () => ({ useAuth: () => ({ user: { id: "seller", marketplaceEligible: true } }) }));
vi.mock("../../apps/web/src/api", () => ({ api: apiMock, clearCsrf: vi.fn(), jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }) }));

import { ChatsPage } from "../../apps/web/src/pages/UserPages";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("removes declined request actions before a delayed refresh and accepts only the new request", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const oldRequest = { id: "old-request", listingId: "listing", buyerId: "buyer", sellerId: "seller", status: "REQUESTED", role: "SELLER", reviewSubmitted: false };
  const cancelledRequest = { ...oldRequest, status: "CANCELLED_BY_SELLER" };
  let rows = [oldRequest];
  let holdRefresh = false;
  let releaseRefresh!: (rows: typeof oldRequest[]) => void;
  const delayedRefresh = new Promise<typeof oldRequest[]>((resolve) => { releaseRefresh = resolve; });
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/conversations") return Promise.resolve([{ id: "conversation", listingId: "listing", listingTitle: "Textbook", lifecycleState: "ACTIVE", buyerId: "buyer", sellerId: "seller", otherUserId: "buyer", otherName: "Buyer", otherAvatarId: "avatar-04", unread: 0, coverImageUrl: null, lastMessageAt: "2026-09-01T12:00:00Z" }]);
    if (path === "/api/conversations/conversation/messages") return Promise.resolve([{ id: "message", clientId: "message-client", conversationId: "conversation", senderId: "buyer", body: "Is this still available?", createdAt: "2026-09-01T12:00:00Z" }]);
    if (path.endsWith("/buyer-reputation")) return Promise.resolve({ reviewCount: 0, averageRating: 0, recentReviews: [] });
    if (path === "/api/transactions") return holdRefresh ? delayedRefresh : Promise.resolve(rows);
    if (path === "/api/transactions/old-request/cancel") {
      holdRefresh = true;
      return Promise.resolve(cancelledRequest);
    }
    if (path === "/api/transactions/new-request/accept") {
      rows = rows.map((row) => row.id === "new-request" ? { ...row, status: "RESERVED" } : row);
      return Promise.resolve(rows[0]);
    }
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/chats/conversation"]}><Routes><Route path="/chats/:conversationId" element={<ChatsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: "View Buyer's profile" })).toHaveAttribute("href", "/seller/buyer");
  expect(await screen.findAllByRole("img", { name: "Buyer's avatar" })).toHaveLength(1);
  const participantNameLinks = screen.getAllByRole("link", { name: "Buyer", exact: true });
  expect(participantNameLinks).toHaveLength(2);
  participantNameLinks.forEach((link) => expect(link).toHaveAttribute("href", "/seller/buyer"));
  expect(document.querySelectorAll('[data-avatar-id="avatar-04"]')).toHaveLength(2);
  fireEvent.click(await screen.findByRole("button", { name: "Decline", exact: true }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Accept and reserve" })).not.toBeInTheDocument());
  expect(client.getQueryData(["transactions"])).toEqual([cancelledRequest]);
  rows = [{ ...oldRequest, id: "new-request" }, cancelledRequest];
  await act(async () => { holdRefresh = false; releaseRefresh(rows); });
  fireEvent.click(await screen.findByRole("button", { name: "Accept and reserve" }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/transactions/new-request/accept", { method: "POST" }));
  expect(apiMock).not.toHaveBeenCalledWith("/api/transactions/old-request/accept", expect.anything());
  await screen.findByRole("link", { name: "Complete exchange" });
  client.clear();
});
