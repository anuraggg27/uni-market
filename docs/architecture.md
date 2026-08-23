# Architecture

## Runtime shape

```text
Browser (React/Vite)
  ├─ REST + HttpOnly session + CSRF ── Express API ── Drizzle ── Neon PostgreSQL
  ├─ Socket.IO ─────────────────────── Express API
  └─ signed PUT only ──────────────────────────────── private Cloudflare R2
                                      ├─ 2Factor OTP
                                      ├─ Google token verification
                                      ├─ SMTP outbox worker
                                      └─ Turnstile siteverify
```

The application is intentionally one frontend and one API service. Stateful business records and authorization decisions live in PostgreSQL. Socket.IO authenticates the same server session and never trusts a browser-supplied user or role.

## Workspaces

- `apps/web`: route-driven React interface, TanStack Query server state, React Hook Form/Zod forms, responsive CSS.
- `apps/api`: Express REST API, Socket.IO, authorization, services and worker entry point.
- `packages/shared`: request schemas, enums, public constants and safety copy shared by browser and server.
- `tests`: unit, Supertest/PGlite integration, and Playwright full-stack journeys.

## Data model

The initial migration creates 23 tables: users, OAuth accounts, sessions, roles, phone verifications, categories, listings and images, favourites, conversations and messages, transactions, reviews, reports, blocks, notifications, support tickets/messages, audit logs, outbox jobs, moderation notes and prohibited terms. Database constraints enforce unique OAuth subjects, verified phone ownership, favourites, conversations, message client IDs, reviews and active reservations. Important records use soft deletion.

Moderation and lifecycle are separate axes. Public discovery always filters `APPROVED` plus `ACTIVE`, `RESERVED`, or `SOLD` where the view specifically supports historical status. Search uses parameterized PostgreSQL predicates and indexed category, state, price, location, seller and creation fields.

## Critical flows

- Authentication: Google credential verification → identity by `sub` → session rotation → HttpOnly cookie → optional onboarding profile.
- Listing: private draft → signed upload → validated/sanitized image → pending review → audited manual decision → public active listing.
- Chat: unique listing/buyer/seller conversation → membership check → persisted message with client idempotency key → Socket.IO broadcast → one first-message outbox job.
- Sale: requested transaction → atomic conditional reservation → seller handover → buyer receipt → completed transaction and one sold-count increment.
- Support: owner-visible ticket → assigned staff reply/internal note → in-app notification and optional email → escalation creates a linked moderation report.

## External service fallbacks

The shared development environment uses isolated Neon and R2 staging resources. PGlite and signed local image storage remain available for disposable local and isolated test runs, with matching authorization and validation semantics. Development OTP prevents external SMS. SMTP jobs remain persisted even when SMTP is not configured. Production startup rejects these unsafe fallbacks.
