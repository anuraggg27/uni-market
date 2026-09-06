import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { operationalMetrics } from './operational-metrics.js';

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
    operationalMetrics.record('otp_provider', false);
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
    operationalMetrics.record('otp_provider', false);
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
    operationalMetrics.record('otp_provider', false);
    logger.warn({ status: response.status }, 'MSG91 access-token verification unavailable');
    throw new AppError(503, 'OTP_UNAVAILABLE', messages.unavailable);
  }

  if (!response.ok || body.type !== 'success' || typeof body.message !== 'string' || !body.message.trim()) {
    if (response.status === 401 || response.status === 403 || (response.ok && !body.type)) {
      operationalMetrics.record('otp_provider', false);
    }
    throw new AppError(400, 'OTP_INVALID', messages.invalid);
  }

  operationalMetrics.record('otp_provider', true);
  return body.message.trim();
}
