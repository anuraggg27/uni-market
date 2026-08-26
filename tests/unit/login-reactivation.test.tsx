// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refreshMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../apps/web/src/auth", () => ({
  useAuth: () => ({ user: null, refresh: refreshMock }),
}));

vi.mock("../../apps/web/src/api", () => {
  class TestApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public fieldErrors?: Record<string, string[]>,
      public details?: unknown,
    ) {
      super(message);
    }
  }
  return {
    api: apiMock,
    ApiError: TestApiError,
    jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
  };
});

import { ApiError } from "../../apps/web/src/api";
import { LoginPage } from "../../apps/web/src/pages/PublicPages";

describe("LoginPage account reactivation", () => {
  let googleCallback: ((input: { credential: string }) => Promise<void>) | undefined;

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-google-client-id");
    apiMock.mockReset();
    refreshMock.mockReset().mockResolvedValue(undefined);
    googleCallback = undefined;
    (window as any).google = {
      accounts: {
        id: {
          initialize: vi.fn((input: { callback: typeof googleCallback }) => {
            googleCallback = input.callback;
          }),
          renderButton: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    delete (window as any).google;
  });

  it("confirms that account closure entered the deletion queue", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { accountClosureQueued: true } }]}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Your account has been added to the deletion queue")).toBeVisible();
    expect(screen.getByText(/Sign in with the same Google account/)).toBeVisible();
  });

  it("offers reactivation after Google identifies a closed account", async () => {
    const purgeAfter = "2027-02-22T12:00:00.000Z";
    apiMock
      .mockRejectedValueOnce(new ApiError(409, "ACCOUNT_PENDING_DELETION", "queued", undefined, { purgeAfter }))
      .mockResolvedValueOnce({ reactivated: true });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).not.toBeNull();
    fireEvent.load(script!);
    expect(googleCallback).toBeTypeOf("function");
    expect((window as any).google.accounts.id.renderButton).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ theme: "filled_black", size: "large", shape: "pill", text: "continue_with" }),
    );

    await act(async () => {
      await googleCallback?.({ credential: "closed-account-google-credential" });
    });
    expect(screen.getByText("Your account is pending deletion")).toBeVisible();
    expect(screen.getByText(/scheduled for deletion or anonymisation/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Reactivate account" }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/api/auth/google",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ credential: "closed-account-google-credential", reactivate: true }),
        }),
      );
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });
});
