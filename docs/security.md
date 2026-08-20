# Security model

## Identity and sessions

Google tokens are verified for signature, issuer, audience, expiry and `email_verified`; `sub`, not email, is the stable identity. Sessions are random, server-stored as hashes, rotated on login, revocable, expiring and transported only in an HttpOnly cookie (`Secure` in production, `SameSite=Lax`). Mutations require a per-session CSRF token. CORS uses one exact frontend origin.

Roles come only from `user_roles`. Public profile updates use an allowlisted schema and cannot assign roles. Suspended users are rejected by protected middleware and Socket.IO. Support staff see only assigned/unassigned support tickets and cannot browse or moderate private conversations.

## Input, output and privacy

Zod validates request bodies, params and query strings. Drizzle parameterizes data values. React renders user text as text. Helmet applies CSP and security headers; JSON bodies are limited to 128 KiB and Socket.IO payloads to 20 KiB. Logs include request IDs but redact authorization, cookies, credentials, tokens, OTP data, secrets, message bodies and full phone numbers.

## OTP

Codes expire in five minutes, are HMAC-hashed, single-use and invalidated on resend/success. Attempts, cooldowns and per-user/phone/IP limits are server-side. Phone numbers are normalized to E.164 and verified numbers are unique. Responses avoid phone enumeration. `DEV_MODE=true` never calls 2Factor and only accepts `999999`; production refuses that configuration.

## Uploads and R2

Only the draft owner can request/finalize/delete an image. Keys are random and owner-scoped; original names are ignored. Finalization checks recorded ownership, size, magic bytes, allowlisted format and dimensions, re-encodes through Sharp, strips EXIF and deletes temporary objects. Pending assets are private and available only through short signed reads. SVG, GIF, PDF, HTML, spoofed and oversized payloads are rejected.

Use `infra/r2-cors.json` with the exact deployed origin. A scheduled cleanup should remove `temporary/` objects older than one hour; R2 lifecycle rules may provide a second safety net.

## Authorization and integrity

Owner/member/participant checks protect listings, images, favourites, conversations, transactions, reviews, notifications and support. Conversations and reviews have database uniqueness constraints. Reservation uses a conditional transaction so only an active listing can be reserved once. Sold count changes only during idempotent buyer completion. Manual listing state cannot create a sale.

Staff moderation records actor, effective role, target, old/new state, internal/user reason, request ID, time and hashed IP. Reported-conversation access is restricted to a captured time window and audited.

## Rate limiting and Turnstile

Application controls cover authentication, OTP, chat, report dedupe and the protected business endpoints. Adaptive Turnstile challenges repeated Google sign-ins, OTP sends, listing submissions and reports. The browser sends successful tokens in `x-turnstile-token`; the server always calls siteverify and treats tokens as single-use. Without a secret in non-production, the verifier is a local no-op; production requires the secret.

Recommended Cloudflare WAF rate-limit rules, in addition to application controls:

| Path/method | Suggested action |
| --- | --- |
| `POST /api/auth/google` | Managed challenge after 10 requests/IP/10 min; block after 30 |
| `POST /api/phone/send` | Managed challenge after 3 requests/IP/10 min; block after 10/hour |
| `POST /api/phone/verify` | Block after 20 requests/IP/10 min |
| `POST /api/listings` and `POST */submit` | Challenge after 10/user or IP/hour |
| `POST /api/uploads/*/presign` | Block after 30/user or IP/hour |
| `POST /api/conversations` | Block after 20/user or IP/hour |
| `POST /api/conversations/*/messages` | Block after 120/user/minute |
| `POST /api/transactions` | Block after 20/user/hour |
| `POST /api/reports` | Challenge after 3/user/hour; block duplicate bursts |
| `POST /api/support` | Block after 10/user/hour |

Tune with observed legitimate traffic and key authenticated limits on a trusted user identifier at the edge when available.

## Operational checklist

- Keep all secrets server-only and scan the built web assets before release.
- Run migrations on a Neon branch and back up before production changes.
- Rotate R2/SMTP/OTP credentials on suspected exposure.
- Monitor authentication/OTP failures, outbox failures, moderation actions and 429 rates.
- Run `npm audit --omit=dev`; triage any production vulnerability before release.

