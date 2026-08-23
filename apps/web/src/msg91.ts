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
let scriptPromise: Promise<void> | null = null;
let initializationPromise: Promise<void> | null = null;

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
        () => reject(new Error("Phone verification could not be loaded")),
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
      reject(new Error("Phone verification could not be loaded"));
    document.head.append(script);
  });

  return scriptPromise;
}

function waitForMethods(): Promise<void> {
  const deadline = Date.now() + 10_000;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (window.sendOtp && window.retryOtp && window.verifyOtp) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Phone verification took too long to initialize"));
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
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await loadScript();
    if (!window.initSendOTP) {
      throw new Error("Phone verification could not be initialized");
    }
    window.initSendOTP({
      ...input,
      exposeMethods: true,
      // Current MSG91 builds require both callbacks during initialization,
      // even when each exposed method supplies its own callbacks.
      success: () => undefined,
      failure: () => undefined,
    });
    await waitForMethods();
  })().catch((error) => {
    initializationPromise = null;
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
  return new Error("Phone verification could not be completed");
}

function callbackResult(
  invoke: (resolve: Msg91Callback, reject: Msg91Callback) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    invoke(resolve, (error) => reject(providerError(error)));
  });
}

export function sendMsg91Otp(identifier: string): Promise<unknown> {
  if (!window.sendOtp)
    return Promise.reject(new Error("Phone verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.sendOtp!(identifier, resolve, reject),
  );
}

export function retryMsg91Otp(requestId?: string): Promise<unknown> {
  if (!window.retryOtp)
    return Promise.reject(new Error("Phone verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.retryOtp!(null, resolve, reject, requestId),
  );
}

export function verifyMsg91Otp(
  otp: string,
  requestId?: string,
): Promise<unknown> {
  if (!window.verifyOtp)
    return Promise.reject(new Error("Phone verification is not ready"));
  return callbackResult((resolve, reject) =>
    window.verifyOtp!(otp, resolve, reject, requestId),
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
