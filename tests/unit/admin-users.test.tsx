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
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({ user: { id: "admin", roles: ["SUPER_ADMIN"] } }),
}));

import { AdminUsers } from "../../apps/web/src/pages/AdminPages";

const users = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    displayName: "Zoya Mehta",
    avatarId: "avatar-04",
    email: "zoya@example.edu",
    phoneVerifiedAt: "2026-09-01T08:00:00.000Z",
    suspendedAt: null,
    completedSales: 3,
    createdAt: "2026-09-06T08:00:00.000Z",
    roles: ["USER", "SUPER_ADMIN"],
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Aarav Kumar",
    avatarId: "avatar-05",
    email: "aarav@example.edu",
    phoneVerifiedAt: null,
    suspendedAt: "2026-09-05T08:00:00.000Z",
    completedSales: 0,
    createdAt: "2026-09-05T08:00:00.000Z",
    roles: ["USER"],
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <QueryClientProvider client={client}>
        <AdminUsers />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("AdminUsers", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/admin/users")) return Promise.resolve(users);
      if (path === "/api/admin/dashboard") {
        return Promise.resolve({ totalUsers: 12, verifiedUsers: 9, activeUsers: 7, newUsers: 3 });
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real metrics, verification semantics, statuses and supported actions", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Users", level: 2 })).toBeVisible();
    const summary = screen.getByRole("region", { name: "User summary" });
    expect(await within(summary).findByText("12")).toBeVisible();
    expect(await within(summary).findByText("75% of all users")).toBeVisible();
    expect(screen.getAllByText("Verified").some((element) => element.tagName === "SPAN")).toBe(true);
    expect(screen.getAllByText("Not verified").some((element) => element.tagName === "SPAN")).toBe(true);
    expect(screen.getByText("SUSPENDED")).toBeVisible();
    expect(screen.getByRole("img", { name: "Zoya Mehta's avatar" })).toHaveAttribute("data-avatar-id", "avatar-04");
    expect(document.querySelector('.admin-user-roles [data-role="SUPER_ADMIN"]')).toBeVisible();
    expect(document.querySelectorAll(".admin-user-row").item(0).querySelectorAll(".admin-user-roles > span")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "View", exact: true })[0]).toHaveAttribute(
      "href",
      "/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(screen.queryByRole("button", { name: /export users/i })).not.toBeInTheDocument();
  });

  it("filters and sorts the returned users without inventing API filters", async () => {
    renderPage();
    await screen.findByText("Users (2)");
    fireEvent.change(screen.getByLabelText("Phone verification"), {
      target: { value: "UNVERIFIED" },
    });
    expect(await screen.findByText("Users (1)")).toBeVisible();
    expect(screen.getByText("Aarav Kumar")).toBeVisible();
    expect(screen.queryByText("Zoya Mehta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "SUPER_ADMIN" } });
    expect(await screen.findByText("Users (1)")).toBeVisible();
    expect(screen.getByText("Zoya Mehta")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent("Aarav Kumar");
      expect(rows[1]).toHaveTextContent("Zoya Mehta");
    });
  });

  it("shows the filtered empty state", async () => {
    renderPage();
    await screen.findByText("Users (2)");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "SUSPENDED" } });
    fireEvent.change(screen.getByLabelText("Phone verification"), {
      target: { value: "VERIFIED" },
    });
    expect(await screen.findByRole("heading", { name: "No users found" })).toBeVisible();
    expect(screen.getByText("Try adjusting or clearing your filters.")).toBeVisible();
  });
});
