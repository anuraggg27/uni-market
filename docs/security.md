# Security model

## Identity and sessions

Google tokens are verified for signature, issuer, audience, expiry and `email_verified`; `sub`, not email, is the stable identity. Sessions are random, server-stored as hashes, rotated on login, revocable, expiring and transported only in an HttpOnly cookie (`Secure` in production, `SameSite=Lax`). Mutations require a per-session CSRF token. CORS uses one exact frontend origin.

Roles come only from `user_roles`. Public profile updates use an allowlisted schema and cannot assign roles. Suspended users are rejected by protected middleware and Socket.IO. Support staff see only assigned/unassigned support tickets and cannot browse or moderate private conversations.

Ordinary verified Google accounts may sign in and browse. Listing, messaging, transactions, favourites, reviews and member support additionally require a separately verified Indian phone, an approved academic-email OTP no older than 12 months, an explicit 18+ declaration and acceptance of the current policy version. Staff administration is role-gated and requires a Google-authenticated staff session no older than eight hours.

## Input, output and privacy

Zod validates request bodies, params and query strings. Drizzle parameterizes data values. React renders user text as text. Helmet applies CSP and security headers; JSON bodies are limited to 128 KiB and Socket.IO payloads to 20 KiB. Logs include request IDs but redact authorization, cookies, credentials, tokens, OTP data, secrets, message bodies and full phone numbers.

## OTP and academic domains

Codes expire in five minutes, are HMAC-hashed, single-use and invalidated on resend/success. Attempts, cooldowns and per-user/phone/IP limits are server-side. Phone numbers are normalized to E.164 and verified numbers are unique. Responses avoid phone enumeration. `DEV_MODE=true` never calls 2Factor and only accepts `999999`; production refuses that configuration.

Student-email codes expire after ten minutes. Email addresses are encrypted at rest and a keyed hash enforces one verified account per address without exposing the value. Only active exact domains, or explicitly approved subdomains, in the staff-reviewed academic-domain registry are accepted. Verification expires after 12 months or immediately when the domain is disabled.

## Uploads and R2

Only the draft owner can request/finalize/delete an image. Keys are random and owner-scoped; original names are ignored. Finalization checks recorded ownership, size, magic bytes, allowlisted format and dimensions, re-encodes through Sharp, strips EXIF and deletes temporary objects. AI-generated or materially altered listing images are prohibited by the Terms, Seller Policy, Community Rules, and Prohibited Items policy. The upload API exposes no synthetic-image declaration or labelling path, and legacy images recorded as synthetic or undeclared cannot be submitted. Pending assets are private and available only through short signed reads. SVG, GIF, PDF, HTML, spoofed and oversized payloads are rejected.

Use `infra/r2-cors.json` with the exact deployed origin. A scheduled cleanup should remove `temporary/` objects older than one hour; R2 lifecycle rules may provide a second safety net.

## Authorization and integrity

Owner/member/participant checks protect listings, images, favourites, conversations, transactions, reviews, notifications and support. Conversations and reviews have database uniqueness constraints. Reservation uses a conditional transaction so only an active listing can be reserved once. Sold count changes only during idempotent buyer completion. Manual listing state cannot create a sale.

Staff moderation records actor, effective role, target, old/new state, internal/user reason, request ID, time and hashed IP. Reported-conversation access is restricted to a captured time window and audited. Prohibited-term controls normalize common evasion patterns and either block submission or flag the listing for a human reviewer. Scam-message controls analyze only outgoing text, require informed confirmation and store risk codes rather than a duplicate message body.

## Privacy, grievance and retention

Student email, public-grievance contact details, complaint text, follow-ups, decisions, staff case notes and direct-email outbox payloads are encrypted. Public grievances use a high-entropy private tracking secret; staff responses exclude tracking hashes and encrypted contact fields. Opening full case details is audited. Priority safety categories receive shorter action targets and appear as alarms in the role-scoped staff queue.

Account closure immediately revokes sessions and hides listings. The daily retention worker supports audited dry-run and enforcement modes, respects active legal holds, anonymises eligible closed accounts after 180 days, erases closed grievance content after the configured grievance-retention period, clears abandoned uploads and removed images on schedule, and periodically queues policy reminders. Production should begin in dry-run and move to enforcement only after reviewing counts and backups.

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
| `POST /api/grievances` | Challenge repeated submissions; block after 5/IP/hour |
| `POST /api/grievances/track` and case updates | Block credential-guessing or update bursts while preserving legitimate reporter access |
| `POST /api/support` | Block after 10/user/hour |

Tune with observed legitimate traffic and key authenticated limits on a trusted user identifier at the edge when available.

## Operational checklist

See [Recovery and operational alerts](recovery-and-alerts.md) for encrypted daily backups with isolated restore verification, protected health metrics, external incident alerts, thresholds, notification tests and production activation gates. The workflows remain disabled until repository configuration is complete; code alone is not evidence of a successful production recovery drill.

- Keep all secrets server-only and scan the built web assets before release.
- Run migrations on a Neon branch and back up before production changes.
- Rotate R2/SMTP/OTP credentials on suspected exposure.
- Monitor authentication/OTP failures, outbox failures, moderation actions and 429 rates.
- Keep the production log bounds enabled: the app container retains at most three 10 MiB files, while the Uni Market Caddy access log retains one active 10 MiB file and at most three compressed rotations for no longer than seven days. Check root-disk usage during each deployment.
- Run `npm audit --omit=dev`; triage any production vulnerability before release.
