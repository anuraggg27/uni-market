# Testing

## Commands

```bash
npm run lint
npm run typecheck
npm run test:unit
LOG_LEVEL=silent npm run test:integration
npm run test:e2e
npm run build
```

`npm run test:all` executes lint, typecheck, coverage tests, build and Playwright. Install Chromium once with `npx playwright install chromium`.

## Test architecture

Unit tests cover environment safety and shared validation. Integration tests use Supertest against a real Express application and an isolated in-memory PGlite database migrated from the production Drizzle SQL. Google verification, SMTP transport and external SMS are injected or disabled; production paths remain intact. Socket tests start a real HTTP/Socket.IO server.

Playwright starts a full API and Vite frontend, uses the secure dev OTP path, uploads generated JPEG bytes through the signed pipeline, and exercises seller approval, rejection/resubmission, buyer chat/transaction/review, report/removal/audit and support resolution. Responsive checks run at 390×844, 768×1024 and 1440×900.

## Acceptance coverage

The integration suites name the specification identifiers for AUTH-01–06, PHONE-01–07, LIST-01–15, CHAT-01–10, TX-01–09, REV-01–06, ADMIN-01–07, SUPPORT-01–04 and SEC-01–10 applicable server paths. PHONE-08/09 are in unit/log safety coverage. Playwright covers E2E-01–06.

Production integrations should additionally run against a disposable Neon branch and R2 test bucket. Never point automated tests at the production database or bucket. Use Cloudflare/Google/2Factor test keys, not live user credentials.

## Manual verification

After automation, inspect homepage, browse filters, listing detail, sell form, chat and admin queue in a real browser. Check keyboard focus, responsive navigation, error/empty/loading states, console errors and horizontal overflow. Do not accept expected warnings as unresolved errors.

