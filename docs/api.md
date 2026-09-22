# REST and real-time API

All JSON responses use `{ "data": ... }`. Errors use `{ "error": { "code", "message", "requestId", "fieldErrors?" } }`. Authenticated mutations require `x-csrf-token` from `GET /api/auth/csrf`. Browser requests include credentials. UUID parameters are validated.

## Route groups

- Auth/profile: `POST /api/auth/google`, `POST /api/auth/google/step-up`, `POST /api/auth/logout`, `GET /api/auth/csrf`, `GET|PATCH /api/auth/me`.
- Eligibility: `POST /api/onboarding/complete`, `GET /api/student-email/config`, `POST /api/student-email/check-availability`, and `POST /api/student-email/verify-provider`. In production, the browser requests and verifies student-email OTPs with the MSG91 widget and the API validates MSG91's access token before recording the exact returned email identifier. The legacy `student-email/send|verify` endpoints work only in explicit local development mode and never queue SMTP mail. Protected marketplace actions require verified phone, current academic-email verification, 18+ attestation, and current policy acceptance.
- Public compliance: `GET /api/compliance`; `POST /api/grievances`; `POST /api/grievances/track`; `POST /api/grievances/:reference/messages`; and `POST /api/grievances/:reference/appeal`. Public case access requires the reference and private tracking secret.
- Privacy: `GET /api/account/export`, `POST /api/account/revoke-sessions`, `DELETE /api/account`.
- Phone: `GET /api/phone/config`, `POST /api/phone/check-availability`, and `POST /api/phone/verify-provider`; local development also exposes `POST /api/phone/send|verify`.
- Catalog/listings: `GET /api/categories`, `GET|POST /api/listings`, `GET /api/listings/:id`, `GET /api/my-listings`, `PATCH /api/listings/:id`, `POST /api/listings/:id/submit|withdraw|duplicate`.
- Uploads: `POST /api/uploads/listings/:id/presign` or `POST /api/uploads/listings/:id/presign-batch`, signed PUT, `POST /api/uploads/listings/:id/finalize`, `DELETE /api/uploads/listings/:listingId/:imageId`.
- Saved/chat/blocking: `GET|POST|DELETE /api/favourites`, `GET|POST /api/conversations`, `GET|POST /api/conversations/:id/messages`, `POST|DELETE /api/blocks/:userId`.
- Transactions/reputation: `GET|POST /api/transactions`, `POST /api/transactions/:id/accept|handover|complete|cancel`, `POST /api/transactions/:id/reviews`, `GET /api/sellers/:id`, `GET /api/leaderboard`.
- Reports/notifications/support: `POST /api/reports`, notification list/read endpoints, support ticket list/create/detail/message/reopen endpoints.
- Analytics: `POST /api/analytics/page-view` records one visit per browser, route and UTC day; `GET /api/admin/analytics?range=7|30|90|365|all` returns staff-only unique-visitor history.
- Admin: `/api/admin/dashboard`, `/api/admin/analytics`, listing queue/detail/decision, statutory grievance queues, reports/detail/resolve, users/detail/suspend, reviews/hide, support/reply/escalate, audit logs, categories, academic domains, provider reviews, legal holds, staff-access reviews and compliance readiness.

Public listing query parameters are `q`, `category`, `minPrice`, `maxPrice`, `condition`, `location`, `negotiable`, `sort`, `page` and `limit`. Only approved, eligible listings are returned. Message, notification and audit histories are paginated.

## Socket.IO

The handshake authenticates `campus_session`. Verified, non-suspended users may emit:

- `conversation:subscribe(conversationId, acknowledgement)`; membership is checked.
- `conversation:read(conversationId, acknowledgement)`; marks only the authenticated participant's incoming messages as read.
- `message:send({ conversationId, clientId, body, safetyConfirmationToken? }, acknowledgement)`; sender identity comes from the session. Scam-risk text returns risk codes and a short-lived confirmation token before any message is stored.
- `listing:watch(listingId)`; broadcasts approximate connection count without viewer identity.

Server events include `message:new` and viewer-count updates. Each authenticated socket joins a private server-managed user room, so inbox updates do not depend on an open conversation and delivery is restored after reconnect. `clientId` makes optimistic retries idempotent. The REST message history remains the source of truth and is polled briefly when the socket is unavailable.

## State rules

Listing moderation: `PENDING → APPROVED|REJECTED|REMOVED`. Listing lifecycle: `DRAFT → ACTIVE → RESERVED → SOLD`, with `EXPIRED` and `WITHDRAWN` alternatives. Transaction: `REQUESTED → RESERVED → HANDED_OVER → COMPLETED`, with participant cancellation or an audited dispute override. Unsupported transitions return conflict/authorization errors.
