# Campus Market

A mobile-first marketplace where students can buy and sell used products, communicate privately, and complete offline exchanges. Registration accepts any verified Google account; institution details are optional.

The application is a TypeScript npm workspace with a Vite/React frontend, Express/Socket.IO API, Drizzle data layer, Neon PostgreSQL production connection, PGlite local/test fallback, and private Cloudflare R2 image pipeline.

## Prerequisites

- Node.js 22 or later and npm 10+
- Chromium for Playwright (`npx playwright install chromium`)
- For production: Neon PostgreSQL, a private R2 bucket, Google OAuth credentials, 2Factor credentials, SMTP, and Cloudflare Turnstile

## Local setup

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. The API listens at `http://localhost:4000`. The default `DATABASE_URL=pglite://.data/marketplace` needs no external database.

Set `DEV_MODE=true` locally to disable external SMS and accept only `999999`. The API logs that development mode is active without logging the code. The configuration validator refuses to start when `NODE_ENV=production` and `DEV_MODE=true`.

Google sign-in requires `GOOGLE_CLIENT_ID` in the API and `VITE_GOOGLE_CLIENT_ID` in the web build. There is no password or email-OTP fallback in production code.

## Database and seed commands

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

For Neon, set `DATABASE_URL` to the pooled connection string. Run migrations against a development branch first, inspect the generated SQL in `apps/api/drizzle`, and only then target production. The seed creates baseline categories and prohibited terms. `BOOTSTRAP_ADMIN_EMAILS` promotes matching users to `SUPER_ADMIN` when they first complete Google sign-in; it is never exposed through public registration.

## Development and production commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run test:all
npm run start -w @campus-market/api
```

The production frontend is in `apps/web/dist`; the API entry point is `apps/api/dist/index.js`. Serve both behind TLS, keep `CLIENT_URL` exact, and set `TRUST_PROXY=true` only behind a trusted single proxy.

## R2 uploads

Draft image uploads use a short-lived signed PUT URL to a random temporary key. Finalization verifies ownership, byte size, actual JPEG/PNG/WebP signature, dimensions, and configured limits; Sharp re-encodes the image as WebP and strips metadata. The temporary object is deleted. Pending images remain private and read URLs are short lived. When R2 credentials are absent outside production, an equivalent signed local storage adapter supports development and tests.

Apply [infra/r2-cors.json](infra/r2-cors.json) to the bucket after replacing the example origin. Never expose R2 keys to Vite variables.

## Listing moderation

Every seller listing starts as a private draft. A verified seller uploads and previews images, then submits to `PENDING`. Only a moderator or super admin can approve it. Approval changes moderation to `APPROVED` and lifecycle to `ACTIVE`; rejection/request-changes records visible feedback; removal is distinct from sale and withdrawal. Material edits return approved listings to `PENDING` and hide them. Every staff decision is audited.

Read [docs/moderation-policy.md](docs/moderation-policy.md) before moderating content.

## Production safety

- Use separate, random session and CSRF secrets; rotate compromised sessions.
- Keep `DEV_MODE=false`; production validation also rejects PGlite and missing Google, OTP, R2, and Turnstile settings.
- Restrict R2 CORS and application CORS to the deployed frontend origin.
- Use a dedicated Neon test branch for hosted integration runs.
- Configure the Cloudflare limits in [docs/security.md](docs/security.md).
- Run `npm audit --omit=dev`, all tests, and the production build before release.
- SMTP and email outbox processing are asynchronous; monitor failed jobs.

Additional documentation: [architecture](docs/architecture.md), [API](docs/api.md), [security](docs/security.md), [testing](docs/testing.md), and [UI references](docs/ui-reference.md).

