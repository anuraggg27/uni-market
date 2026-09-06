// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  useAuth: () => ({
    user: {
      id: "admin-user",
      roles: ["USER", "SUPER_ADMIN"],
    },
  }),
}));

import {
  AdminDashboard,
  AdminShell,
} from "../../apps/web/src/pages/AdminPages";

const dashboard = {
  totalUsers: 12,
  newUsers: 3,
  verifiedUsers: 10,
  activeUsers: 7,
  pendingListings: 2,
  activeListings: 9,
  rejectedListings: 1,
  removedListings: 0,
  completedTransactions: 5,
  reservedListings: 2,
  openReports: 1,
  openTickets: 4,
  averageRating: 4.75,
  emailFailures: 0,
  otpSuccess: 8,
  otpFailure: 2,
  r2StorageUsage: null,
};

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<AdminDashboard />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminDashboard", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/admin/dashboard") return Promise.resolve(dashboard);
      if (path === "/api/admin/audit-logs") {
        return Promise.resolve([
          {
            id: "audit-1",
            action: "LISTING_APPROVE",
            targetType: "LISTING",
            targetId: "listing-12345678",
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses real dashboard metrics and audit entries without fabricated trends", async () => {
    renderDashboard();

    expect(
      screen.getByRole("heading", { level: 1, name: "Administration" }),
    ).toBeVisible();
    expect(await screen.findByText("Total users")).toBeVisible();
    const primaryMetrics = screen.getByLabelText("Primary marketplace metrics");
    expect(within(primaryMetrics).getByText("12")).toBeVisible();
    expect(within(primaryMetrics).getByText("7")).toBeVisible();
    expect(within(primaryMetrics).getByText("2")).toBeVisible();
    expect(within(primaryMetrics).getByText("4")).toBeVisible();
    expect(screen.getByText("4.8")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Historical activity is not available yet"),
    ).toBeVisible();
    expect(await screen.findByText("Listing approve")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/api/admin/dashboard");
    expect(apiMock).toHaveBeenCalledWith("/api/admin/audit-logs");
  });

  it("keeps every admin route and quick action navigable", async () => {
    renderDashboard();
    await screen.findByText("Total users");

    expect(
      screen.getByRole("navigation", { name: "Admin sections" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Pending listings" }),
    ).toHaveAttribute("href", "/admin/listings/pending");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "href",
      "/admin/reports",
    );
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "/admin/support",
    );
    expect(
      screen.getByRole("link", { name: "Compliance registers" }),
    ).toHaveAttribute("href", "/admin/compliance");
    expect(
      screen.getByRole("link", { name: "Review pending listings" }),
    ).toHaveAttribute("href", "/admin/listings/pending");
    expect(
      screen.getByRole("button", { name: "Open admin navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
