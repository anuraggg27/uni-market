// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, socketMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  socketMock: {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock("../../apps/web/src/api", () => ({
  api: apiMock,
  clearCsrf: vi.fn(),
  jsonBody: (value: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }),
}));
vi.mock("socket.io-client", () => ({ io: () => socketMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { RequestsPage } from "../../apps/web/src/pages/UserPages";

const transactions = [
  {
    id: "new-completed",
    listingId: "listing-new",
    listingTitle: "Newer calculator",
    listingPrice: "\u20B9900",
    buyerId: "buyer",
    sellerId: "seller",
    role: "BUYER",
    status: "COMPLETED",
    createdAt: "2026-09-03T10:00:00.000Z",
    updatedAt: "2026-09-03T10:00:00.000Z",
    reviewSubmitted: false,
  },
  {
    id: "received-pending",
    listingId: "listing-received",
    listingTitle: "Received desk request",
    listingPrice: "\u20B91,200",
    buyerId: "another-buyer",
    sellerId: "seller",
    role: "SELLER",
    status: "REQUESTED",
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    reviewSubmitted: false,
  },
  {
    id: "old-reviewed",
    listingId: "listing-old",
    listingTitle: "Older textbook",
    listingPrice: "\u20B9350",
    buyerId: "buyer",
    sellerId: "seller",
    role: "BUYER",
    status: "COMPLETED",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    reviewSubmitted: true,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/requests"]}>
        <RequestsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequestsPage", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/transactions") return Promise.resolve(transactions);
      if (path === "/api/transactions/new-completed/reviews") return Promise.resolve({ id: "review-1" });
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("filters, sorts, and submits verified reviews without changing transaction APIs", async () => {
    renderPage();

    await screen.findByText("Newer calculator");
    const allTab = screen.getByRole("tab", { name: /^All/ });
    const sentTab = screen.getByRole("tab", { name: /^Sent/ });
    const receivedTab = screen.getByRole("tab", { name: /^Received/ });
    expect(allTab).toHaveAttribute("aria-selected", "true");
    expect(within(allTab).getByText("3")).toBeVisible();
    expect(within(sentTab).getByText("2")).toBeVisible();
    expect(within(receivedTab).getByText("1")).toBeVisible();
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("Newer calculator");

    fireEvent.change(screen.getByLabelText("Sort requests"), { target: { value: "oldest" } });
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("Older textbook");

    fireEvent.click(receivedTab);
    expect(screen.getByText("Received desk request")).toBeVisible();
    expect(screen.queryByText("Newer calculator")).not.toBeInTheDocument();

    fireEvent.click(sentTab);
    expect(screen.getByText("Already reviewed")).toBeVisible();
    expect(screen.getByRole("radio", { name: "5 stars" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Short review"), { target: { value: "Smooth campus exchange." } });
    fireEvent.click(screen.getByRole("button", { name: "Leave verified review" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/api/transactions/new-completed/reviews",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: 5, text: "Smooth campus exchange.", tags: [] }),
      },
    ));
  });
});
