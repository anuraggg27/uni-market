// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, authState, refreshMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  authState: { user: null as Record<string, unknown> | null },
  refreshMock: vi.fn(),
}));

vi.mock("../../apps/web/src/api", () => ({
  api: apiMock,
  clearCsrf: vi.fn(),
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({
    user: authState.user,
    loading: false,
    refresh: refreshMock,
    clearSession: vi.fn(),
  }),
}));

import { SettingsPage } from "../../apps/web/src/pages/UserPages";

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage eligibility declarations", () => {
  beforeEach(() => {
    authState.user = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "student@gmail.com",
      displayName: "Student",
      avatarId: "avatar-01",
      institution: "Example Institute",
      campus: null,
      graduationYear: null,
      phoneVerifiedAt: null,
      phoneE164: null,
      studentEmailMasked: null,
      studentEmailDomain: "students.example.edu",
      studentEmailVerifiedAt: null,
      studentEmailExpiresAt: null,
      adultAttestedAt: null,
      onboardingComplete: true,
      marketplaceEligible: false,
      eligibility: {
        phoneVerified: false,
        studentEmailVerified: false,
        adultAttested: false,
        policiesAccepted: false,
      },
      suspendedAt: null,
      roles: ["USER"],
    };
    refreshMock.mockReset().mockResolvedValue(undefined);
    apiMock.mockReset().mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/phone/config" || path === "/api/student-email/config") {
        return Promise.resolve({ provider: "development", otpLength: 6, retryAfter: 30 });
      }
      if (path === "/api/academic-domains") {
        return Promise.resolve([{ id: "domain-1", domain: "students.example.edu", institutionName: "Example Institute" }]);
      }
      if (path === "/api/email-preferences") {
        return Promise.resolve({ enabled: true, listingUpdates: true, transactionUpdates: true, messageUpdates: true, policyReminders: true, updatedAt: null });
      }
      if (path === "/api/eligibility/declarations" && options?.method === "POST") {
        return Promise.resolve({ completed: true });
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows two eligibility steps and saves age and policy acceptance in place", async () => {
    const { container } = renderSettings();

    const overview = container.querySelector(".eligibility-checks");
    expect(overview).not.toBeNull();
    expect(within(overview as HTMLElement).getAllByRole("button")).toHaveLength(2);
    expect(within(overview as HTMLElement).getByRole("button", { name: /Age & policies/ })).toBeVisible();
    expect(within(overview as HTMLElement).getByRole("button", { name: /Student email/ })).toBeVisible();
    expect(within(overview as HTMLElement).queryByRole("button", { name: /Mobile number/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review Requirements" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("I declare that I am at least 18 years old"));
    fireEvent.click(screen.getByLabelText("I accept the platform policies"));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirements" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/api/eligibility/declarations",
      expect.objectContaining({ method: "POST" }),
    ));
    const declarationCall = apiMock.mock.calls.find(([path]) => path === "/api/eligibility/declarations");
    expect(JSON.parse(String(declarationCall?.[1]?.body))).toEqual({
      adultAttested: true,
      acceptTerms: true,
      acknowledgePrivacy: true,
      acceptCommunityRules: true,
      policyVersion: "2026-08-27",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });
});
