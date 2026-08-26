// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeMsg91,
  msg91AccessToken,
  msg91Identifier,
  msg91RequestId,
  sendMsg91Otp,
} from "../../apps/web/src/msg91";

afterEach(() => {
  document.body.replaceChildren();
  delete window.initSendOTP;
  delete window.sendOtp;
  delete window.retryOtp;
  delete window.verifyOtp;
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

  it("initializes MSG91 in the selected verification card", async () => {
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
    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    document.getElementById("msg91-phone-captcha")!.replaceWith(
      Object.assign(document.createElement("div"), { id: "msg91-phone-captcha" }),
    );
    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    await initializeMsg91({ ...common, captchaRenderId: "msg91-student-email-captcha" });

    expect(window.initSendOTP).toHaveBeenCalledTimes(3);
    expect(window.initSendOTP).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ captchaRenderId: "msg91-phone-captcha" }),
    );
    expect(window.initSendOTP).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ captchaRenderId: "msg91-phone-captcha" }),
    );
    expect(window.initSendOTP).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ captchaRenderId: "msg91-student-email-captcha" }),
    );
  });

  it("clears stale exposed methods before switching verification cards", async () => {
    document.body.innerHTML = `
      <div id="msg91-phone-captcha"></div>
      <div id="msg91-student-email-captcha"></div>
    `;
    const methodsPresentAtInitialization: boolean[] = [];
    window.initSendOTP = vi.fn(() => {
      methodsPresentAtInitialization.push(Boolean(window.sendOtp));
      window.sendOtp = vi.fn();
      window.retryOtp = vi.fn();
      window.verifyOtp = vi.fn();
    });
    const common = { widgetId: "widget", tokenAuth: "token" };

    await initializeMsg91({ ...common, captchaRenderId: "msg91-phone-captcha" });
    await initializeMsg91({
      ...common,
      captchaRenderId: "msg91-student-email-captcha",
    });

    expect(methodsPresentAtInitialization).toEqual([false, false]);
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
    } finally {
      vi.useRealTimers();
    }
  });
});
