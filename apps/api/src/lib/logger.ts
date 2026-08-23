import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie',
      '*.otp', '*.code', '*.credential', '*.token', '*.password', '*.secret',
      'MSG91_AUTH_KEY', 'MSG91_TOKEN_AUTH', 'R2_SECRET_ACCESS_KEY', 'SMTP_PASSWORD', 'SESSION_SECRET', 'CSRF_SECRET'
    ],
    censor: '[REDACTED]'
  }
});
