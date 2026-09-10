import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../apps/api/src/config";
import { TurnstileVerifier } from "../../apps/api/src/services/turnstile";
import { logger } from "../../apps/api/src/lib/logger";

const baseConfig = loadConfig({ NODE_ENV: "test", DEV_MODE: "false" });

describe("TurnstileVerifier", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("bypasses verification outside production when no secret is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new TurnstileVerifier(baseConfig).requireForSuspiciousRequest(
        undefined,
        "127.0.0.1",
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires both a token and configured secret in production", async () => {
    const verifier = new TurnstileVerifier({
      ...baseConfig,
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "",
    });

    await expect(
      verifier.requireForSuspiciousRequest(undefined, "203.0.113.10"),
    ).rejects.toMatchObject({
      status: 403,
      code: "BOT_CHECK_REQUIRED",
    });
  });

  it("submits the token, remote address, and an idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    const verifier = new TurnstileVerifier({
      ...baseConfig,
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    });

    await verifier.requireForSuspiciousRequest(
      "turnstile-token",
      "203.0.113.11",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      secret: "turnstile-secret",
      response: "turnstile-token",
      remoteip: "203.0.113.11",
      idempotency_key: expect.any(String),
    });
  });

  it("rejects a challenge that Cloudflare does not accept", async () => {
    const log = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] }), { status: 200 }),
      ),
    );
    const verifier = new TurnstileVerifier({
      ...baseConfig,
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    });

    await expect(
      verifier.requireForSuspiciousRequest("bad-token", "203.0.113.12"),
    ).rejects.toMatchObject({
      status: 403,
      code: "BOT_CHECK_FAILED",
    });
    expect(log).toHaveBeenCalledWith(
      { turnstileErrorCodes: ['timeout-or-duplicate'], providerStatus: 200 },
      'Turnstile token verification failed',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('bad-token');
    expect(JSON.stringify(log.mock.calls)).not.toContain('turnstile-secret');
  });
});
