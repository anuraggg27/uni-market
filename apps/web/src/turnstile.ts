declare global {
  interface Window {
    __uniMarketTurnstileLoaded?: () => void;
    turnstile?: {
      ready(callback: () => void): void;
      render(container: HTMLElement, options: Record<string, unknown>): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  if (window.turnstile) return Promise.resolve();
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = () => {
      settled = true;
      window.clearTimeout(timeout);
      delete window.__uniMarketTurnstileLoaded;
    };
    const fail = () => {
      if (settled) return;
      finish();
      script.remove();
      reject(new Error("The security check could not load. Check your connection and try again."));
    };
    const timeout = window.setTimeout(fail, 15_000);
    // Async loading must use the SDK's onload callback. Calling ready() with
    // an async/deferred api.js script throws inside the real Cloudflare SDK.
    window.__uniMarketTurnstileLoaded = () => {
      if (settled) return;
      if (!window.turnstile) { fail(); return; }
      finish();
      resolve();
    };
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__uniMarketTurnstileLoaded";
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

function challengeErrorMessage(code: string): string {
  if (["110100", "110110", "110200", "400020", "400070"].includes(code)) {
    return `The security check is unavailable for this site. Please contact support. Reference: ${code}.`;
  }
  if (code === "200100") {
    return `Check that your device's date and time are correct, then reload this page. Reference: ${code}.`;
  }
  if (code === "110500") {
    return `Open this page in an up-to-date Chrome or Safari browser and try again. Reference: ${code}.`;
  }
  const reference = /^\d{6}$/.test(code) ? ` Reference: ${code}.` : "";
  return `The security check was interrupted. It will retry automatically, or you can try again now.${reference}`;
}

export async function solveTurnstile(): Promise<string> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  if (!sitekey)
    throw new Error(
      "A security check is required but Turnstile is not configured",
    );
  await loadScript();

  return new Promise<string>((resolve, reject) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "security-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "security-check-title");
    const panel = document.createElement("div");
    panel.className = "security-dialog";
    const title = document.createElement("h2");
    title.id = "security-check-title";
    title.textContent = "One quick security check";
    const guidance = document.createElement("p");
    guidance.textContent =
      "We noticed repeated requests. Complete this check to continue.";
    const widget = document.createElement("div");
    widget.className = "security-widget";
    widget.dataset.action = "turnstile-spin-v1";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.hidden = true;
    const retry = document.createElement("button");
    retry.className = "button primary";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.hidden = true;
    const cancel = document.createElement("button");
    cancel.className = "button secondary";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    panel.append(title, guidance, widget, status, retry, cancel);
    backdrop.append(panel);
    document.body.append(backdrop);
    cancel.focus();

    let widgetId = "";
    let settled = false;
    const cleanup = () => {
      settled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
      backdrop.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    const showError = (message: string) => {
      if (settled) return;
      status.textContent = message;
      status.hidden = false;
      retry.hidden = false;
    };
    cancel.addEventListener(
      "click",
      () => {
        cleanup();
        reject(new Error("Security check cancelled"));
      },
      { once: true },
    );
    const renderWidget = () => {
      widgetId = window.turnstile!.render(widget, {
        sitekey,
        theme: "auto",
        size: widget.getBoundingClientRect().width < 300 ? "compact" : "flexible",
        action: "turnstile-spin-v1",
        retry: "auto",
        "refresh-expired": "auto",
        "refresh-timeout": "auto",
        callback: (token: string) => {
          if (settled) return;
          cleanup();
          resolve(token);
        },
        "error-callback": (code: string) => {
          // Keep the widget mounted so Cloudflare can recover from transient failures.
          showError(challengeErrorMessage(code));
          return true;
        },
        "expired-callback": () => showError("The security check expired. A new check is starting."),
        "timeout-callback": () => showError("The security check timed out. Complete the new check to continue."),
      });
      // Also clean up if the provider completes synchronously during render.
      if (settled) window.turnstile!.remove(widgetId);
    };
    retry.addEventListener("click", () => {
      status.hidden = true;
      retry.hidden = true;
      cancel.focus();
      try {
        if (widgetId) window.turnstile!.reset(widgetId);
        else renderWidget();
      } catch {
        showError("The security check could not start. Reload the page or try again.");
      }
    });
    try { renderWidget(); }
    catch { showError("The security check could not start. Reload the page or try again."); }
  });
}
