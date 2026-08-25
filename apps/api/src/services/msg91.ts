import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

type Msg91VerificationResponse = {
  type?: unknown;
  message?: unknown;
};

export async function verifiedMsg91Identifier(
  config: AppConfig,
  accessToken: string,
  messages: { unavailable: string; invalid: string },
): Promise<string> {
  if (!config.MSG91_AUTH_KEY) {
    throw new AppError(503, 'OTP_UNAVAILABLE', messages.unavailable);
  }

  let response: Response;
  try {
    response = await fetch(config.MSG91_VERIFY_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        authkey: config.MSG91_AUTH_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ 'access-token': accessToken }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    logger.warn({ err: error }, 'MSG91 access-token verification request failed');
    throw new AppError(503, 'OTP_UNAVAILABLE', messages.unavailable);
  }

  let body: Msg91VerificationResponse = {};
  try {
    body = await response.json() as Msg91VerificationResponse;
  } catch {
    // A non-JSON provider response cannot prove ownership of an identifier.
  }

  if (response.status === 429 || response.status >= 500) {
    logger.warn({ status: response.status }, 'MSG91 access-token verification unavailable');
    throw new AppError(503, 'OTP_UNAVAILABLE', messages.unavailable);
  }

  if (!response.ok || body.type !== 'success' || typeof body.message !== 'string' || !body.message.trim()) {
    throw new AppError(400, 'OTP_INVALID', messages.invalid);
  }

  return body.message.trim();
}
