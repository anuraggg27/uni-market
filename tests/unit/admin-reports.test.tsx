// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({ user: { id: "admin-user", roles: ["SUPER_ADMIN"] } }),
}));

import { AdminReports } from "../../apps/web/src/pages/AdminPages";

const reports = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    publicReference: "RPT-2026-001",
    reporterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    targetType: "LISTING",
    targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    reason: "SCAM",
    details: "Seller requested payment outside the marketplace.",
    status: "OPEN",
    createdAt: "2026-09-06T10:20:02.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    publicReference: "RPT-2026-002",
    reporterId: null,
    targetType: "USER",
    targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    reason: "HARASSMENT",
    details: null,
    status: "INVESTIGATING",
    createdAt: "2026-09-05T08:14:11.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    publicReference: "RPT-2026-003",
    reporterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    targetType: "LISTING",
    targetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    reason: "WRONG_CATEGORY",
    details: "The listing is filed under the wrong category.",
    status: "OPEN",
    createdAt: "2026-09-04T18:02:33.000Z",
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/reports"]}>
        <AdminReports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminReports", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/admin/reports") return Promise.resolve(reports);
      if (path === "/api/listings/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
        return Promise.resolve({
          title: "Engineering calculator",
          location: "North campus",
          images: [{ url: "https://images.example.test/calculator.webp" }],
        });
      }
      if (path === "/api/listings/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") {
        return Promise.resolve({
          title: "First-year textbook bundle",
          location: "Library pickup",
          images: [],
        });
      }
      if (path === "/api/admin/users/cccccccc-cccc-4ccc-8ccc-cccccccccccc") {
        return Promise.resolve({
          displayName: "Reported student",
          avatarId: "avatar-02",
          campus: "South campus",
        });
      }
      if (path === "/api/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
        return Promise.resolve({
          displayName: "Aarav Mehta",
          avatarId: "avatar-03",
        });
      }
      if (path === "/api/admin/users/dddddddd-dddd-4ddd-8ddd-dddddddddddd") {
        return Promise.resolve({
          displayName: "Sneha Kapoor",
          avatarId: "avatar-04",
        });
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real queue metrics, report context, privacy-safe reporters and routes", async () => {
    renderPage();

    expect(await screen.findByText("Reports (3)")).toBeVisible();
    const metrics = screen.getByRole("region", { name: "Report summary" });
    const openMetric = within(metrics).getByText("Open reports").closest("article");
    expect(openMetric).not.toBeNull();
    expect(within(openMetric!).getByText("2")).toBeVisible();
    expect(within(metrics).getByText("In review")).toBeVisible();
    const listingTitle = await screen.findByText("Engineering calculator");
    const firstReport = listingTitle.closest('[role="row"]');
    expect(firstReport).not.toBeNull();
    expect(screen.getByText("Seller requested payment outside the marketplace.")).toBeVisible();
    expect(screen.getByText("Identity not available")).toBeVisible();
    expect(listingTitle).toBeVisible();
    expect(screen.getByText("Aarav Mehta")).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Engineering calculator thumbnail" }),
    ).toHaveAttribute("src", "https://images.example.test/calculator.webp");
    expect(screen.queryByText("Resolved reports")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export reports" })).not.toBeInTheDocument();
    expect(within(firstReport!).getByRole("link", { name: "Investigate" })).toHaveAttribute(
      "href",
      "/admin/reports/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/admin/reports/22222222-2222-4222-8222-222222222222",
    );
  });

  it("filters, searches, sorts and clears without changing the report API", async () => {
    renderPage();
    await screen.findByText("Reports (3)");

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "INVESTIGATING" },
    });
    expect(screen.getByText("Reports (1)")).toBeVisible();
    expect(await screen.findByText("Reported student")).toBeVisible();
    expect(screen.queryByText("Engineering calculator")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Reports (3)")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "outside the marketplace" },
    });
    expect(screen.getByText("Reports (1)")).toBeVisible();
    expect(await screen.findByText("Engineering calculator")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "no result" },
    });
    expect(screen.getByRole("heading", { name: "No reports found" })).toBeVisible();
    expect(screen.getByText("Try adjusting or clearing your filters.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "oldest" },
    });
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(
        within(rows[0]).getByText("First-year textbook bundle"),
      ).toBeVisible();
    });
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/api/admin/reports"),
    ).toHaveLength(1);
  });

  it("shows the unfiltered empty state when the active queue is clear", async () => {
    apiMock.mockResolvedValueOnce([]);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "No reports found" }),
    ).toBeVisible();
    expect(screen.getByText("Everything looks clear.")).toBeVisible();
    expect(screen.getByText("Reports (0)")).toBeVisible();
  });
});
