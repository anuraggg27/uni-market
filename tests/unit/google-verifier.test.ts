import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../apps/api/src/config";

const { verifyIdToken } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(options: unknown) {
      return verifyIdToken(options);
    }
  },
}));

import { ProductionGoogleVerifier } from "../../apps/api/src/services/google";

const configured = () =>
  loadConfig({
    NODE_ENV: "test",
    DEV_MODE: "false",
    GOOGLE_CLIENT_ID: "google-client-id.apps.example.test",
  });

describe("ProductionGoogleVerifier", () => {
  beforeEach(() => verifyIdToken.mockReset());

  it("rejects sign-in when Google is not configured", async () => {
    const verifier = new ProductionGoogleVerifier(
      loadConfig({ NODE_ENV: "test", DEV_MODE: "false" }),
    );

    await expect(verifier.verify("credential")).rejects.toMatchObject({
      status: 503,
      code: "GOOGLE_NOT_CONFIGURED",
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("accepts verified Google claims without importing the profile photo", async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-user-1",
        email: "student@example.edu",
        email_verified: true,
        iss: "https://accounts.google.com",
        name: "Student Name",
        picture: "https://images.example.test/avatar.png",
      }),
    });
    const verifier = new ProductionGoogleVerifier(configured());

    await expect(verifier.verify("valid-credential")).resolves.toEqual({
      sub: "google-user-1",
      email: "student@example.edu",
      emailVerified: true,
      name: "Student Name",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "valid-credential",
      audience: "google-client-id.apps.example.test",
    });
  });

  it("uses the email prefix when Google omits a display name", async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-user-2",
        email: "fallback.name@example.edu",
        email_verified: true,
        iss: "accounts.google.com",
      }),
    });

    await expect(
      new ProductionGoogleVerifier(configured()).verify("credential"),
    ).resolves.toMatchObject({ name: "fallback.name" });
  });

  it.each([
    ["missing subject", { email: "student@example.edu", email_verified: true, iss: "accounts.google.com" }],
    ["unverified email", { sub: "user", email: "student@example.edu", email_verified: false, iss: "accounts.google.com" }],
    ["invalid issuer", { sub: "user", email: "student@example.edu", email_verified: true, iss: "https://attacker.example" }],
  ])("rejects %s without leaking provider details", async (_case, payload) => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    await expect(
      new ProductionGoogleVerifier(configured()).verify("credential"),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_GOOGLE_CREDENTIAL",
      message: "Google sign-in could not be verified",
    });
  });

});
