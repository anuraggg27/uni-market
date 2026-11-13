# Unread message reminders

## Existing architecture and changes

Messages belong to listing/buyer/seller conversations. `messages.read_at` is the
authoritative read receipt: the REST message fetch and Socket.IO
`conversation:read` mark incoming messages read. The unused participant read
timestamp is not used or changed. Both REST and Socket.IO still queue the existing
`first-conversation-message` email once per conversation through its unique
outbox dedupe key. Existing message notifications, events and reservations remain.

The new finite job reuses SMTP, the branded HTML/plain-text renderer,
`CLIENT_URL`, `messageUpdates` preferences, and the durable email outbox.
Migration `0015_unread_message_reminders.sql` adds two nullable delivery markers
to conversations and an optional conversation foreign key and attempt timestamp to the outbox. It also
adds a partial unread-message index and a unique pending-reminder index. No data
is reset. Successful cycle state survives the outbox's one-year retention policy.

## Eligibility and delivery

The oldest unread, undeleted buyer message newer than the last successfully
reminded snapshot must be at least five hours old. Successful reminders must be
at least 24 hours apart. A successful cycle covers all messages present when the
job was queued, including newer messages in that same unread batch. Only incoming
messages created after that snapshot can start a future cycle; the old unread
messages cannot make a new message eligible early. All production comparisons
and delivery timestamps use PostgreSQL's clock and timezone-aware timestamps.

Only approved active/reserved listings, active buyer/seller accounts, unblocked
participants, valid recipient emails and enabled message preferences qualify.
Eligibility and remaining unread messages are checked again immediately before
SMTP delivery. Read, opted-out and invalid queued reminders are suppressed. There
is an unavoidable small race if the seller reads during the SMTP call itself.

Queue deduplication uses the triggering message ID and at most one pending job
per conversation. Workers hold an outbox row lock across SMTP delivery and the
atomic recording of `sent_at` and conversation cycle/cooldown markers. Competing
workers skip locked rows. A failed SMTP call records an attempt and backs off
2/4/8/16 minutes (actual retry occurs on the next scheduled run); the fifth failed
attempt becomes terminal and appears in existing outbox monitoring. Restarting
the job preserves queued retries. Each execution queries up to ten keyset pages
of 100 candidates and delivers up to 100 queued jobs, ordered by availability.

SMTP offers no provider idempotency API: if the provider accepts a message and the
worker crashes or the database fails before committing success, a retry can send
it again. A stable SMTP `Message-ID` helps receivers deduplicate but cannot
guarantee it. Ambiguous SMTP timeouts have the same limitation. Database locking
prevents ordinary concurrent duplicates; exact-once external delivery is not
claimed. A hard process crash may also roll back that attempt's bookkeeping.

## Production activation (Docker droplet)

The current deployment is an always-running Docker container named `uni-market`
on a Linux droplet. Reminder discovery/delivery does not run on API requests or
in a process-local interval. Follow the ordered, audited
[deployment and activation runbook](unread-reminders-deployment.md), including
backup, a retained rollback image and controlled tests before timer startup.
The Docker CMD applies migration before the new container becomes healthy; the
runbook's later explicit migration invocation is an idempotent confirmation.

The service uses rootful local Docker, explicitly selects `/app` and invokes
`/usr/local/bin/node /app/apps/api/dist/jobs/unread-reminders.js` with the
container's inherited environment. An in-container GNU timeout bounds it to
25 minutes (then force-kills after 10 seconds); systemd bounds its Docker client
to 27 minutes. It checks UTC quarter-hours plus up to 30 seconds jitter, catches
up after a reboot and prevents overlapping service invocations. Independent
invocations are also safe through database locks. No new environment variables
or paid services are needed. Host paths, rootful socket and unit syntax require
the operator preflight described in the runbook.
Existing `SMTP_*`, `CLIENT_URL`, `DATABASE_URL`, and `DEV_MODE=false` must be valid.
The ordinary email worker excludes reminders so it cannot bypass revalidation.

The job supports `--dry-run` (read-only candidate and due-pending counts),
`--conversation-id UUID` (scoped scheduling and delivery), and `--queue-only`
(requires a UUID target; queues without SMTP so reading before delivery can be
checked). These modes preserve normal eligibility and cooldown. Production
timestamp snapshots retain PostgreSQL microsecond precision to avoid requalifying
an already covered message after JavaScript timestamp truncation.

These files do **not** activate the timer on the production host by themselves.
There is no production access or deployment implied by local implementation.
SMTP failures exit the command with status 1; check the systemd journal and the
existing protected operations endpoint's failed/pending outbox counts. Structured
logs include starts, evaluated/queued/sent/skipped/failed totals and failed job
IDs, without addresses or message bodies. Database failures exit nonzero and
leave work for the next invocation. Run the service manually after recovery if
needed. For a terminal failed job, investigate SMTP, then reset that existing
outbox row's `failed_at`, `attempts`, and `available_at`; do not delete/recreate
its dedupe key. Revalidation still applies on retry.
The CLI's in-memory operational counters are not shared with the API process;
use durable outbox monitoring and systemd journal/exit status. Stopping the timer
does not abort an already running SMTP call. Follow the runbook's drain and
old-image rollback guard before rolling back the application.

## Email and unread interface

The reminder uses the existing cream/plum mobile email layout with a plain-text
fallback, listing title, prominent “View message” button, and email settings link.
It includes no private message body or buyer details. The CTA uses
`CLIENT_URL` and `/marketplace/chats/:conversationId`. Existing sign-in preserves
the destination for onboarded users; existing membership checks reject outsiders.
Deleted/unknown conversations remain behind authentication and the normal
unavailable-conversation UI.

The conversation list retains its existing per-conversation message badge;
deleted messages no longer contribute. Desktop Chats, the mobile menu and bottom
Chats navigation show the number of unread **conversations**, shared through a
user-scoped React Query request. The existing notifications socket invalidates
the count when messages arrive, and its new private `chats:updated` signal syncs
read changes across tabs. Reconnect/visibility and the existing disconnected
fallback refresh recover missed events. Signed-out caches are cleared.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run test:unit`,
`npm run test:integration`, `npm run test:postgres`, `npm run build`, and
`npm run test:e2e`. New reminder integration tests use migrated PGlite and an
injected clock, exercising eligibility, state persistence, grouping, cooldown,
read revalidation, retries, concurrent jobs, invalid records, preferences, links
and authenticated unread counts. Unit tests cover the badges, realtime
invalidation, account switching and the login return path. The existing chat and
transaction suites continue covering first-message mail, Socket.IO, reservations
and listing flows. PostgreSQL concurrency tests require the existing isolated
local `TEST_POSTGRES_URL`; they are skipped if it is not configured.

## Files changed

- `README.md`: reminder activation link.
- `apps/api/src/db/schema.ts`: durable cycle/attempt tracking and indexes.
- `apps/api/drizzle/0015_unread_message_reminders.sql`: additive migration.
- `apps/api/drizzle/meta/0015_snapshot.json`: generated schema snapshot.
- `apps/api/drizzle/meta/_journal.json`: migration registration.
- `apps/api/src/services/unread-reminders.ts`: eligibility, deduplication, revalidation and delivery.
- `apps/api/src/jobs/unread-reminders.ts`: finite scheduled command.
- `apps/api/src/services/email.ts`: keeps the general worker from claiming reminders.
- `apps/api/src/services/email-preferences.ts`: uses existing message preferences.
- `apps/api/src/services/email-templates.ts`: branded reminder template.
- `apps/api/src/services/notification-events.ts`: private chat read invalidation signal.
- `apps/api/src/routes/communication.ts`: unread conversation count and read invalidation.
- `apps/api/src/socket.ts`: broadcasts read invalidation using the existing namespace.
- `apps/web/src/components/ChatUnreadBadge.tsx`: user-scoped shared count badge.
- `apps/web/src/components/Navbar.tsx`: desktop and mobile menu badges.
- `apps/web/src/components/Layout.tsx`: bottom Chats badge.
- `apps/web/src/components/NotificationUpdates.tsx`: realtime count updates and cache cleanup.
- `apps/web/src/pages/UserPages.tsx`: refreshes counts after read and preserves incoming unread state on own sends.
- `apps/web/src/styles.css`: compact badge style.
- `infra/operations/uni-market-unread-reminders.service`: Docker job service.
- `infra/operations/uni-market-unread-reminders.timer`: persistent 15-minute host schedule.
- `tests/integration/unread-reminders.test.ts`: reminder/API/private read signal acceptance tests.
- `tests/integration/unread-reminder-migration.test.ts`: additive upgrade, migration replay and snapshot consistency checks.
- `tests/postgres/unread-reminders.test.ts`: independent PostgreSQL worker concurrency test.
- `tests/unit/chat-unread-badge.test.tsx`: realtime badge and account isolation tests.
- `tests/unit/chat-login-routing.test.tsx`: authenticated conversation return path test.
- `tests/unit/unread-reminder-cli.test.ts`: isolated CLI argument, configuration and failure exit-code checks.
- `tests/unit/unsaved-changes-guard.test.tsx`: native AbortSignal test setup for Node's Request; existing navigation assertions preserved.
- `apps/api/package.json` and `package-lock.json`: security updates required by the production dependency audit, including Nodemailer 10.5 for Node 22.
- `docs/unread-reminders.md`: architecture, operation, limitations and verification report.
- `docs/unread-reminders-deployment.md`: audited activation sequence, rollback procedure and unchecked operator sign-off.

## Local verification results (13 November 2026)

These are the original implementation results. The subsequent production-readiness
audit, corrections, current verification results and exact audit file list are
in [unread-reminders-deployment.md](unread-reminders-deployment.md#audit-verification-and-changed-files).

- Upstream fetch and fast-forward check: `main` was already up to date with `origin/main`; the working tree started clean.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed. Vite reports its existing large-chunk advisory.
- Full integration suite: 222 tests passed. After the final private read-signal test and migration updates, the focused reminder suite passed all 21 tests.
- Focused badge, login return-path and existing email-worker suites: 10 tests passed.
- Full unit suite: 179 passed, 2 failed. The notification-tray failure passed on isolated rerun. The unchanged unsaved-changes test still fails with a jsdom/Node `AbortSignal` mismatch; its matching browser journey passes.
- Browser suite: 38 passed, 2 existing Turnstile cases skipped because no test site key was configured.
- PostgreSQL suite: 14 skipped because `TEST_POSTGRES_URL` is not configured; Docker Desktop's Linux engine is unavailable. The new PostgreSQL concurrency test is included for the existing CI database job, but was not executed locally.
- Migration applied successfully to isolated in-memory test databases. No existing local or production database was migrated; no real SMTP email was sent and no production timer was installed.

The final release validation supersedes these historical local results: 188 unit,
231 integration and 40 browser tests passed after the security dependency
updates and native AbortSignal test-setup correction. Lint, typecheck, build and
the production dependency audit passed; PostgreSQL's 14 tests remain skipped
locally and mandatory in CI. See the [final local release validation](unread-reminders-deployment.md#final-local-release-validation-13-november-2026)
for exact checks and remaining operator gates.

The outbox payload review found no application defect: both JSONB `payload` and
nullable `encrypted_payload` already exist. Reminder conversation/title/snapshot
metadata follows existing user-email storage conventions without message bodies
or recipient addresses; sensitive direct-email payloads retain their existing
encryption. Integration tests now explicitly reload persisted metadata and
verify mocked delivery, read suppression, retry preservation and encryption.
