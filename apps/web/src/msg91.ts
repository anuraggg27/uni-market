import { api, jsonBody } from './api';

// Best-effort aggregate telemetry only. Never send identifiers, codes, tokens,
// provider responses or error messages; reporting must not delay verification.
function recordProviderOutcome(success: boolean): void {
  try {
    void api('/api/operations/otp-event', {
      method: 'POST', ...jsonBody({ success }), signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } catch { /* Unsupported browser telemetry must not interfere with OTP callbacks. */ }
}

type Msg91Callback = (data: unknown) => void;

type Msg91Configuration = {
  widgetId: string;
  tokenAuth: string;
  exposeMethods: true;
  captchaRenderId: string;
  success?: Msg91Callback;
  failure?: Msg91Callback;
};

declare global {
  interface Window {
    initSendOTP?: (configuration: Msg91Configuration) => void;
    sendOtp?: (
      identifier: string,
      success?: Msg91Callback,
      failure?: Msg91Callback,
    ) => void;
    retryOtp?: (
      channel: string | null,
      success?: Msg91Callback,
      failure?: Msg91Callback,
      requestId?: string,
    ) => void;
    verifyOtp?: (
      otp: string,
      success?: Msg91Callback,
      failure?: Msg91Callback,
      requestId?: string,
    ) => void;
  }
}

const SCRIPT_URL = "https://verify.msg91.com/otp-provider.js";
const CALLBACK_TIMEOUT_MS = 30_000;
const CAPTCHA_HOST_ID = "msg91-verification-captcha";
let scriptPromise: Promise<void> | null = null;
let initializationPromise: Promise<void> | null = null;
let initializationKey: string | null = null;
let initializationComplete = false;
let captchaHost: HTMLDivElement | null = null;

function exposedMethodsReady(): boolean {
  return Boolean(window.sendOtp && window.retryOtp && window.verifyOtp);
}

function mountCaptchaHost(containerId: string): HTMLDivElement {
  const container = document.getElementById(containerId);
  if (!container) throw new Error("Verification form could not be found");
  captchaHost ??= Object.assign(document.createElement("div"), {
    id: CAPTCHA_HOST_ID,
    className: "msg91-captcha-host",
  });
  container.append(captchaHost);
  return captchaHost;
}

export function detachMsg91Captcha(): void {
  captchaHost?.remove();
}

function loadScript(): Promise<void> {
  if (window.initSendOTP) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Verification could not be loaded")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Verification could not be loaded"));
    document.head.append(script);
  });

  return scriptPromise;
}

function waitForMethods(): Promise<void> {
  const deadline = Date.now() + 10_000;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (exposedMethodsReady()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Verification took too long to initialize"));
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

export function initializeMsg91(input: {
  widgetId: string;
  tokenAuth: string;
  captchaRenderId: string;
}): Promise<void> {
  const nextKey = `${input.widgetId}:${input.tokenAuth}`;
  mountCaptchaHost(input.captchaRenderId);
  if (initializationComplete && !exposedMethodsReady()) {
    initializationPromise = null;
    initializationKey = null;
    initializationComplete = false;
  }
  if (initializationPromise && initializationKey === nextKey) {
    return initializationPromise;
  }

  if (initializationPromise && initializationKey !== nextKey) {
    return Promise.reject(
      new Error("Verification configuration changed. Reload this page and try again."),
    );
  }

  const previousInitialization = initializationPromise;
  initializationKey = nextKey;

  initializationPromise = (async () => {
    await previousInitialization?.catch(() => undefined);
    await loadScript();
    if (!window.initSendOTP) {
      throw new Error("Verification could not be initialized");
    }
    if (!captchaHost?.isConnected) {
      throw new Error("Verification form could not be found");
    }
    captchaHost.replaceChildren();
    window.initSendOTP({
      ...input,
      captchaRenderId: CAPTCHA_HOST_ID,
      exposeMethods: true,
      // Current MSG91 builds require both callbacks during initialization,
      // even when each exposed method supplies its own callbacks.
      success: () => undefined,
      failure: () => undefined,
    });
    await waitForMethods();
    initializationComplete = true;
  })().catch((error) => {
    recordProviderOutcome(false);
    if (initializationKey === nextKey) {
      initializationPromise = null;
      initializationKey = null;
      initializationComplete = false;
    }
    throw error;
  });

  return initializationPromise;
}

function providerError(value: unknown): Error {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return new Error(value.message);
  }
  return new Error("Verification could not be completed");
}

function callbackResult(
  invoke: (resolve: Msg91Callback, reject: Msg91Callback) => void,
  verification = false,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: (value: unknown) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback(value);
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      recordProviderOutcome(false);
      finish(
        reject,
        new Error("Verification provider did not respond. Please try again."),
      );
    }, CALLBACK_TIMEOUT_MS);
    try {
      invoke(
        (value) => {
          if (!settled && !verification) recordProviderOutcome(true);
          finish(resolve, value);
        },
        (error) => {
          if (!settled && !verification) recordProviderOutcome(false);
          finish(reject, providerError(error));
        },
      );
    } catch (error) {
      if (!settled && !verification) recordProviderOutcome(false);
      finish(reject, providerError(error));
    }
  });
}

export function sendMsg91Otp(identifier: string): Promise<unknown> {
  if (!window.sendOtp)
    return Promise.reject(new Error("Verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.sendOtp!(identifier, resolve, reject),
  );
}

export function retryMsg91Otp(
  requestId?: string,
  channel: string | null = null,
): Promise<unknown> {
  if (!window.retryOtp)
    return Promise.reject(new Error("Verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.retryOtp!(channel, resolve, reject, requestId),
  );
}

export function verifyMsg91Otp(
  otp: string,
  requestId?: string,
): Promise<unknown> {
  if (!window.verifyOtp)
    return Promise.reject(new Error("Verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.verifyOtp!(otp, resolve, reject, requestId), true,
  );
}

export function msg91Identifier(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits;
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new Error("Enter a valid 10-digit Indian mobile number");
  }
  return `91${local}`;
}

export function msg91RequestId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["reqId", "requestId", "req_id", "request_id"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  if (
    record.type === "success" &&
    typeof record.message === "string" &&
    /^[A-Za-z0-9_-]{12,}$/.test(record.message)
  ) {
    return record.message;
  }
  return undefined;
}

export function msg91AccessToken(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("MSG91 did not return a verification token");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["access-token", "accessToken", "token"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  if (
    typeof record.message === "string" &&
    record.message.split(".").length === 3
  ) {
    return record.message;
  }
  throw new Error("MSG91 did not return a verification token");
}
