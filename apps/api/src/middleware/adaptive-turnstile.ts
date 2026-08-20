import type { RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import { TurnstileVerifier } from "../services/turnstile.js";

interface AdaptiveTurnstileOptions {
  threshold: number;
  windowMs: number;
  applies?: (method: string, path: string) => boolean;
}

export function adaptiveTurnstile(
  config: AppConfig,
  options: AdaptiveTurnstileOptions,
): RequestHandler {
  const verifier = new TurnstileVerifier(config);
  const attempts = new Map<string, number[]>();

  return (req, _res, next) => {
    if (options.applies && !options.applies(req.method, req.path)) {
      next();
      return;
    }

    const now = Date.now();
    const identity = req.auth?.userId ?? req.ip ?? "unknown";
    const recent = (attempts.get(identity) ?? []).filter(
      (time) => time > now - options.windowMs,
    );
    recent.push(now);
    attempts.set(identity, recent);

    if (attempts.size > 10_000) {
      for (const [key, values] of attempts) {
        if (!values.some((time) => time > now - options.windowMs))
          attempts.delete(key);
      }
    }

    if (recent.length <= options.threshold) {
      next();
      return;
    }

    void verifier
      .requireForSuspiciousRequest(
        req.header("x-turnstile-token"),
        req.ip ?? "unknown",
      )
      .then(() => next(), next);
  };
}
