// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMsg91,
  msg91AccessToken,
  msg91Identifier,
  msg91RequestId,
  sendMsg91Otp,
  verifyMsg91Otp,
} from "../../apps/web/src/msg91";

const { telemetryApi } = vi.hoisted(() => ({ telemetryApi: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../apps/web/src/api', () => ({ api: telemetryApi, jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }) }));
beforeEach(() => { telemetryApi.mockReset().mockResolvedValue(undefined); });

afterEach(() => {
  document.body.replaceChildren();
  for (const key of ["initSendOTP", "sendOtp", "retryOtp", "verifyOtp"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (descriptor?.configurable) Reflect.deleteProperty(window, key);
    else if (descriptor?.writable) Reflect.set(window, key, undefined);
  }
  vi.restoreAllMocks();
});

describe("MSG91 client response handling", () => {
  it("formats Indian phone numbers without a plus sign", () => {
    expect(msg91Identifier("+91 98765 43210")).toBe("919876543210");
    expect(() => msg91Identifier("12345")).toThrow(/valid 10-digit/);
  });

  it("extracts the request ID and access token from MSG91 response shapes", () => {
    expect(
      msg91RequestId({ type: "success", message: "336870744532313134323444" }),
    ).toBe("336870744532313134323444");
    expect(msg91AccessToken({ "access-token": "header.payload.signature" })).toBe(
      "header.payload.signature",
    );
    expect(() => msg91AccessToken({ type: "success" })).toThrow(
      /verification token/,
    );
  });

  it("initializes MSG91 once and moves its persistent captcha between cards", async () => {
    document.body.innerHTML = `
      <div id="msg91-phone-captcha"></div>
      <div id="msg91-student-email-captcha"></div>
    `;
    window.initSendOTP = vi.fn(() => {
      window.sendOtp = vi.fn();
      window.retryOtp = vi.fn();
      window.verifyOtp = vi.fn();
    });
    const common = { widgetId: "widget", tokenAuth: "token" };

    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    expect(document.getElementById("msg91-verification-captcha")?.parentElement?.id).toBe(
      "msg91-phone-captcha",
    );
    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    document.getElementById("msg91-phone-captcha")!.replaceWith(
      Object.assign(document.createElement("div"), { id: "msg91-phone-captcha" }),
    );
    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    await initializeMsg91({ ...common, captchaRenderId: "msg91-student-email-captcha" });

    expect(window.initSendOTP).toHaveBeenCalledTimes(1);
    expect(window.initSendOTP).toHaveBeenCalledWith(
      expect.objectContaining({ captchaRenderId: "msg91-verification-captcha" }),
    );
    expect(document.getElementById("msg91-verification-captcha")?.parentElement?.id).toBe(
      "msg91-student-email-captcha",
    );
  });

  it("does not delete non-configurable methods exposed by MSG91", async () => {
    document.body.innerHTML = `
      <div id="msg91-phone-captcha"></div>
      <div id="msg91-student-email-captcha"></div>
    `;
    const staleSendOtp = vi.fn();
    Object.defineProperty(window, "sendOtp", {
      value: staleSendOtp,
      writable: true,
      configurable: false,
    });
    window.initSendOTP = vi.fn(() => {
      window.sendOtp = vi.fn();
      window.retryOtp = vi.fn();
      window.verifyOtp = vi.fn();
    });
    const common = { widgetId: "widget", tokenAuth: "token" };

    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    await initializeMsg91({
      ...common,
      captchaRenderId: "msg91-phone-captcha",
    });

    expect(window.initSendOTP).toHaveBeenCalledOnce();
    expect(window.sendOtp).not.toBe(staleSendOtp);
  });

  it("rejects when the provider never settles its callback", async () => {
    vi.useFakeTimers();
    try {
      window.sendOtp = vi.fn();
      const request = sendMsg91Otp("student@students.example.edu");
      const rejection = expect(request).rejects.toThrow(
        "Verification provider did not respond. Please try again.",
      );

      await vi.advanceTimersByTimeAsync(30_000);

      await rejection;
      expect(telemetryApi).toHaveBeenCalledWith('/api/operations/otp-event', expect.objectContaining({ body: '{"success":false}' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports only an aggregate outcome, never the identifier or provider error', async () => {
    window.sendOtp = (_identifier, _success, failure) => failure?.({ message: 'Private provider diagnostic for student@example.edu' });
    await expect(sendMsg91Otp('student@example.edu')).rejects.toThrow();
    expect(telemetryApi).toHaveBeenCalledOnce();
    expect(telemetryApi.mock.calls[0][1].body).toBe('{"success":false}');
    expect(JSON.stringify(telemetryApi.mock.calls)).not.toContain('student@example.edu');
  });

  it('does not treat an incorrect customer OTP as a provider outage', async () => {
    window.verifyOtp = (_otp, _success, failure) => failure?.({ message: 'Invalid OTP' });
    await expect(verifyMsg91Otp('1234')).rejects.toThrow('Invalid OTP');
    expect(telemetryApi).not.toHaveBeenCalled();
  });
});
