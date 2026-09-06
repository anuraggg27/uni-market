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
  jsonBody: (value: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }),
}));

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      roles: ["SUPER_ADMIN"],
    },
  }),
}));

import { AdminGrievances } from "../../apps/web/src/pages/ComplianceAdminPages";

const cases = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    publicReference: "UM-20260906-URGENT",
    category: "CHILD_SAFETY",
    priority: "URGENT",
    reason: "CSAM_CHILD_SAFETY",
    status: "OPEN",
    assignedTo: null,
    acknowledgeDueAt: "2026-09-06T09:00:00.000Z",
    actionDueAt: "2026-09-06T10:00:00.000Z",
    acknowledgedAt: null,
    appealedAt: null,
    createdAt: "2026-09-06T08:00:00.000Z",
    overdue: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    publicReference: "UM-20260905-REVIEW",
    category: "UNLAWFUL_CONTENT",
    priority: "HIGH",
    reason: "CREDIBLE_THREAT",
    status: "INVESTIGATING",
    assignedTo: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    acknowledgeDueAt: "2026-09-06T08:00:00.000Z",
    actionDueAt: "2026-09-07T08:00:00.000Z",
    acknowledgedAt: "2026-09-05T09:00:00.000Z",
    appealedAt: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    overdue: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    publicReference: "UM-20260904-GENERAL",
    category: "GENERAL",
    priority: "STANDARD",
    reason: "OTHER",
    status: "OPEN",
    assignedTo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    acknowledgeDueAt: "2026-09-05T08:00:00.000Z",
    actionDueAt: "2026-09-11T08:00:00.000Z",
    acknowledgedAt: "2026-09-04T09:00:00.000Z",
    appealedAt: null,
    createdAt: "2026-09-04T08:00:00.000Z",
    overdue: false,
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminGrievances />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("AdminGrievances", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/admin/grievances") return Promise.resolve(cases);
      if (path === "/api/admin/grievances/11111111-1111-4111-8111-111111111111") {
        return Promise.resolve({
          reason: "CSAM_CHILD_SAFETY",
          details: "Safety complaint details supplied by the reporter.",
          targetUrl: "http://localhost:5173/marketplace/listing/example",
          events: [],
        });
      }
      if (path.endsWith("/acknowledge")) {
        return Promise.resolve({ acknowledgedAt: "2026-09-06T10:30:00.000Z" });
      }
      return Promise.reject(new Error("Unexpected API call: " + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real active-queue metrics, deadlines and privacy-safe case rows", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Grievances & safety" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "New case" })).toHaveAttribute(
      "href",
      "/grievance",
    );
    await screen.findByText("Cases (3)");
    const metrics = screen.getByRole("region", { name: "Case summary" });
    expect(within(metrics).getByText("Open cases")).toBeVisible();
    expect(within(metrics).getByText("In review")).toBeVisible();
    expect(within(metrics).getByText("Assigned cases")).toBeVisible();
    expect(within(metrics).getByText("Urgent cases")).toBeVisible();
    expect(within(metrics).getAllByText("2")).toHaveLength(2);
    expect(screen.getAllByText("Private reporter")).toHaveLength(3);
    expect(screen.getByText("UM-20260906-URGENT")).toBeVisible();
    expect(screen.getAllByText(/Overdue/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Resolved cases")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New case" })).not.toBeInTheDocument();
  });

  it("filters and sorts the real queue without changing the API", async () => {
    renderPage();
    await screen.findByText("Cases (3)");

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "INVESTIGATING" },
    });
    expect(screen.getByText("Cases (1)")).toBeVisible();
    expect(screen.getByText("UM-20260905-REVIEW")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Assigned to"), {
      target: { value: "MINE" },
    });
    expect(screen.getByText("Cases (1)")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "child safety" },
    });
    expect(screen.getByText("UM-20260906-URGENT")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "oldest" },
    });
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]).getByText("UM-20260904-GENERAL")).toBeVisible();
    });
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/api/admin/grievances"),
    ).toHaveLength(1);
  });

  it("preserves the existing investigation and acknowledge flow", async () => {
    renderPage();
    await screen.findByText("UM-20260906-URGENT");

    fireEvent.click(screen.getAllByRole("button", { name: "Investigate" })[0]);
    expect(
      await screen.findByText(
        "Safety complaint details supplied by the reporter.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Case History")).toBeVisible();
    expect(screen.getByText("Send an Update")).toBeVisible();
    expect(screen.getByText("Record a Decision")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge & Assign to Me" }),
    );
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/grievances/11111111-1111-4111-8111-111111111111/acknowledge",
        { method: "POST" },
      );
    });
  });

  it("uses the specified empty state when the active queue is clear", async () => {
    apiMock.mockResolvedValueOnce([]);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "No open grievances" }),
    ).toBeVisible();
    expect(screen.getByText("All current cases have been handled.")).toBeVisible();
  });
});
