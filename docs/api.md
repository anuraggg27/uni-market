# REST and real-time API

All JSON responses use `{ "data": ... }`. Errors use `{ "error": { "code", "message", "requestId", "fieldErrors?" } }`. Authenticated mutations require `x-csrf-token` from `GET /api/auth/csrf`. Browser requests include credentials. UUID parameters are validated.

## Route groups

- Auth/profile: `POST /api/auth/google`, `POST /api/auth/logout`, `GET /api/auth/csrf`, `GET|PATCH /api/auth/me`.
- Phone: `POST /api/phone/send`, `POST /api/phone/verify`.
- Catalog/listings: `GET /api/categories`, `GET|POST /api/listings`, `GET /api/listings/:id`, `GET /api/my-listings`, `PATCH /api/listings/:id`, `POST /api/listings/:id/submit|withdraw|duplicate`.
- Uploads: `POST /api/uploads/listings/:id/presign`, signed PUT, `POST /api/uploads/listings/:id/finalize`, `DELETE /api/uploads/listings/:listingId/images/:imageId`.
- Saved/chat/blocking: `GET|POST|DELETE /api/favourites`, `GET|POST /api/conversations`, `GET|POST /api/conversations/:id/messages`, `POST|DELETE /api/blocks/:userId`.
- Transactions/reputation: `GET|POST /api/transactions`, `POST /api/transactions/:id/accept|handover|complete|cancel`, `POST /api/transactions/:id/reviews`, `GET /api/sellers/:id`, `GET /api/leaderboard`.
- Reports/notifications/support: `POST /api/reports`, notification list/read endpoints, support ticket list/create/detail/message/reopen endpoints.
- Admin: `/api/admin/dashboard`, listing queue/detail/decision, reports/detail/resolve, users/detail/suspend, reviews/hide, support/reply/escalate, audit logs and categories.

Public listing query parameters are `q`, `category`, `minPrice`, `maxPrice`, `condition`, `location`, `negotiable`, `sort`, `page` and `limit`. Only approved, eligible listings are returned. Message, notification and audit histories are paginated.

## Socket.IO

The handshake authenticates `campus_session`. Verified, non-suspended users may emit:

- `conversation:subscribe(conversationId, acknowledgement)`; membership is checked.
- `message:send({ conversationId, clientId, body }, acknowledgement)`; sender identity comes from the session.
- `listing:view:join(listingId)` / `listing:view:leave(listingId)`; broadcasts approximate connection count without viewer identity.

Server events include `message:new` and viewer-count updates. `clientId` makes optimistic retries idempotent. The REST message history remains the source of truth after reconnect.

## State rules

Listing moderation: `PENDING → APPROVED|REJECTED|REMOVED`. Listing lifecycle: `DRAFT → ACTIVE → RESERVED → SOLD`, with `EXPIRED` and `WITHDRAWN` alternatives. Transaction: `REQUESTED → RESERVED → HANDED_OVER → COMPLETED`, with participant cancellation or an audited dispute override. Unsupported transitions return conflict/authorization errors.

