import { Router } from 'express';
import { z } from 'zod';
import { phoneSchema } from '@campus-market/shared';
import type { Database } from '../db/client.js';
import type { AppConfig } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { OtpService } from '../services/otp.js';

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return input;
}

export function phoneRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  const service = new OtpService(db, config);
  router.get('/config', requireAuth, (_req, res) => {
    if (config.DEV_MODE) {
      res.json({ data: { provider: 'development', otpLength: 6, retryAfter: config.OTP_RESEND_COOLDOWN_SECONDS } });
      return;
    }
    res.json({
      data: {
        provider: 'msg91',
        widgetId: config.MSG91_WIDGET_ID,
        tokenAuth: config.MSG91_TOKEN_AUTH,
        otpLength: config.MSG91_OTP_LENGTH,
        retryAfter: config.OTP_RESEND_COOLDOWN_SECONDS
      }
    });
  });
  router.post('/check-availability', requireAuth, asyncRoute(async (req, res) => {
    const phoneE164 = phoneSchema.parse(normalizePhone(z.object({ phone: z.string().max(30) }).parse(req.body).phone));
    await service.assertPhoneAvailable(req.auth!.userId, phoneE164);
    res.json({ data: { available: true } });
  }));
  router.post('/send', requireAuth, asyncRoute(async (req, res) => {
    const phoneE164 = phoneSchema.parse(normalizePhone(z.object({ phone: z.string().max(30) }).parse(req.body).phone));
    const result = await service.send(req.auth!.userId, phoneE164, sha256(req.ip));
    res.json({ data: { message: 'If the number can receive messages, a code has been sent', ...result } });
  }));
  router.post('/verify', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ phone: z.string().max(30), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const phoneE164 = phoneSchema.parse(normalizePhone(input.phone));
    await service.verify(req.auth!.userId, phoneE164, input.code);
    res.json({ data: { verified: true } });
  }));
  router.post('/verify-provider', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({
      phone: z.string().max(30),
      accessToken: z.string().min(20).max(8_192)
    }).parse(req.body);
    const phoneE164 = phoneSchema.parse(normalizePhone(input.phone));
    await service.verifyProviderToken(req.auth!.userId, phoneE164, input.accessToken, sha256(req.ip));
    res.json({ data: { verified: true } });
  }));
  return router;
}
