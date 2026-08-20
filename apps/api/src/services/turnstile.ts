import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';

export class TurnstileVerifier {
  constructor(private config: AppConfig) {}
  async requireForSuspiciousRequest(token: string | undefined, remoteIp: string): Promise<void> {
    if (this.config.NODE_ENV !== 'production' && !this.config.TURNSTILE_SECRET_KEY) return;
    if (!token || !this.config.TURNSTILE_SECRET_KEY) throw new AppError(403, 'BOT_CHECK_REQUIRED', 'Complete the security check and try again');
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: this.config.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp, idempotency_key: crypto.randomUUID() })
    });
    const result = await response.json() as { success?: boolean };
    if (!result.success) throw new AppError(403, 'BOT_CHECK_FAILED', 'The security check was not accepted');
  }
}
