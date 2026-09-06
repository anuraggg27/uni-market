// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({ user: { id: "admin-user", roles: ["SUPER_ADMIN"] } }),
}));

import { PendingListings } from "../../apps/web/src/pages/AdminPages";

const rows = [
  {
    listing: {
      id: "listing-1",
      title: "Engineering calculator",
      description: "Scientific calculator with the original cover and manual.",
      submittedAt: "2026-09-06T10:30:00.000Z",
    },
    sellerName: "Priya Sharma",
    sellerCompletedSales: 2,
    categoryName: "Electronics",
    coverImageUrl: "https://images.example.test/calculator.webp",
    flaggedTerms: [],
  },
  {
    listing: {
      id: "listing-2",
      title: "First year textbook bundle",
      description: "Calculus and physics textbooks in good condition.",
      submittedAt: "2026-09-05T08:15:00.000Z",
    },
    sellerName: "Arjun Kumar",
    sellerCompletedSales: 1,
    categoryName: "Books",
    flaggedTerms: ["restricted term"],
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/listings/pending"]}>
        <PendingListings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PendingListings", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/categories") {
        return Promise.resolve([
          { id: "category-books", name: "Books" },
          { id: "category-electronics", name: "Electronics" },
        ]);
      }
      if (path === "/api/admin/users") {
        return Promise.resolve([
          { id: "seller-priya", displayName: "Priya Sharma" },
          { id: "seller-arjun", displayName: "Arjun Kumar" },
        ]);
      }
      if (path.startsWith("/api/admin/listings/pending?")) {
        return Promise.resolve(rows);
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real queue fields and preserves the existing filters and review routes", async () => {
    renderPage();

    expect(await screen.findByText("2 pending listings")).toBeVisible();
    const firstCard = screen.getAllByRole("article")[0];
    expect(within(firstCard).getByText("Engineering calculator")).toBeVisible();
    expect(
      within(firstCard).getByText(
        "Scientific calculator with the original cover and manual.",
      ),
    ).toBeVisible();
    expect(within(firstCard).getByText("Priya Sharma")).toBeVisible();
    expect(within(firstCard).getByText("2 completed sales")).toBeVisible();
    expect(within(firstCard).getByText("Electronics")).toBeVisible();
    expect(
      within(firstCard).getByRole("img", {
        name: "Engineering calculator listing preview",
      }),
    ).toHaveAttribute("src", "https://images.example.test/calculator.webp");
    expect(screen.getByText("Flagged")).toHaveAttribute(
      "title",
      "Matched terms: restricted term",
    );
    expect(screen.getAllByRole("link", { name: "Review" })[0]).toHaveAttribute(
      "href",
      "/admin/listings/listing-1",
    );
    expect(screen.getByText("Showing 1–2 of 2 pending listings")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "newest" },
    });
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/listings/pending?sort=newest",
      ),
    );

    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/listings/pending?"),
    );
  });

  it("shows the dedicated empty state without an empty table", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/categories" || path === "/api/admin/users") {
        return Promise.resolve([]);
      }
      if (path.startsWith("/api/admin/listings/pending?")) {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });

    renderPage();

    expect(await screen.findByText("0 pending listings")).toBeVisible();
    expect(screen.getByRole("heading", { name: "No pending listings" })).toBeVisible();
    expect(screen.getByText("Everything has been reviewed.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
