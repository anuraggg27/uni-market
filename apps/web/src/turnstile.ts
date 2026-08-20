declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("The security check could not be loaded"));
    document.head.append(script);
  });
  return scriptPromise;
}

export async function solveTurnstile(): Promise<string> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  if (!sitekey)
    throw new Error(
      "A security check is required but Turnstile is not configured",
    );
  await loadScript();

  return new Promise<string>((resolve, reject) => {
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
    const cancel = document.createElement("button");
    cancel.className = "button secondary";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    panel.append(title, guidance, widget, cancel);
    backdrop.append(panel);
    document.body.append(backdrop);
    cancel.focus();

    let widgetId = "";
    const cleanup = () => {
      if (widgetId) window.turnstile?.remove(widgetId);
      backdrop.remove();
    };
    cancel.addEventListener(
      "click",
      () => {
        cleanup();
        reject(new Error("Security check cancelled"));
      },
      { once: true },
    );
    widgetId = window.turnstile!.render(widget, {
      sitekey,
      theme: "light",
      callback: (token: string) => {
        cleanup();
        resolve(token);
      },
      "error-callback": () => {
        cleanup();
        reject(new Error("The security check was not accepted"));
      },
      "expired-callback": () => {
        cleanup();
        reject(new Error("The security check expired"));
      },
    });
  });
}
