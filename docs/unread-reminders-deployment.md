# Unread reminder deployment and activation

Audit date: 13 November 2026. **READY WITH DOCUMENTED LIMITATIONS.** This is an
operator runbook, not a record of production execution. No production host,
database, environment, container, timer or mailbox was accessed during the audit.
Reminders are not confirmed active. Complete the release gates and host checks
below before activation.

## Verified repository contract and discrepancies

| Item | Repository evidence / expected deployment |
| --- | --- |
| Source checkout | `/opt/uni-market/source`, in `infra/deploy.sh` and `infra/deploy-entrypoint.sh` |
| Deployment | Push/merge to `main` triggers `.github/workflows/ci.yml`; both quality and browser jobs must pass before the production deploy job |
| Bootstrap | A forced-command deployment key invokes an installed root-owned bootstrap. Its installed absolute path is not recorded in this repository; do not invent one or replace it |
| Compose | `docker-compose.production.yml`, service `app`, image `uni-market:production`, container `uni-market` |
| Runtime | `node:22-bookworm-slim`, `/app`, container user `node`, read-only root filesystem, writable `/tmp`, 384 MiB / 0.75 CPU |
| Environment | Container creation uses `.env.production`; `docker exec` inherits that container environment. Do not pass a workstation `.env` or override production variables |
| API / health | Host `127.0.0.1:3020` forwards to container port 4000; `/health` is liveness, not proof of schema or SMTP health |
| Startup | Docker CMD runs `node apps/api/dist/db/migrate.js`, then seed, then API. **Migration runs before health becomes available**, not after the healthy deployment |
| Reminder entry point | `/app/apps/api/dist/jobs/unread-reminders.js`; migration entry point `/app/apps/api/dist/db/migrate.js` |
| Host units | Only the new reminder unit templates are in source. Existing installed units and rootful Docker socket location remain host preflight checks |
| Schedule | UTC quarter-hours plus up to 30 seconds random delay; persistent catch-up after missed runs. An already running service is not started again |
| Timeout correction | An in-container `timeout` bounds the actual worker to 25 minutes, then KILL after 10 seconds; systemd bounds its Docker client to 27 minutes. A host-client timeout alone cannot be relied on to stop an exec process |
| Rollback correction | The deploy script removes its temporary `uni-market:rollback` tag after success. Preserve a separately named image before deploying |

Migration 0015 adds four nullable columns, a nullable foreign key, and two partial
indexes. It has no data reset, table recreation or destructive down migration.
The generated snapshot matches the schema and follows snapshot 0014; the journal
registers its timestamp once. An isolated test upgrades populated 0014 data,
preserves messages and existing initial-email jobs, and reruns Drizzle migration
without creating another journal entry. Existing rows have NULL reminder foreign
keys, so the new pending uniqueness constraint does not collide with old emails.

Drizzle records the applied file hash/timestamp in `drizzle.__drizzle_migrations`.
Use its migrator, never execute the SQL file directly or add `IF NOT EXISTS` to
hide an unexpected schema. **Do not run migrators concurrently.** The normal
deploy script uses `/tmp/uni-market-deploy.lock`; the explicit verification
command below takes the same host lock. A previous manual schema change or an
edited already-applied migration must be investigated, not overwritten.

`CREATE INDEX` and `ALTER TABLE` can take locks and scan existing tables. Local
PGlite testing does not establish production table sizes, migration-role grants,
lock duration, disk space or Neon availability. Verify against a representative
isolated PostgreSQL restore and select a suitable maintenance window. The current
deploy script waits about two minutes for health before rollback; a long index
build can exceed that window. Do not repeatedly redeploy into that condition;
review the maintenance/migration strategy before proceeding.

The safety audit also fixed timestamp truncation at microsecond boundaries,
made disabled jobs fail visibly, and cancels/removes old-account unread requests.
The CLI also applies its failure exit code after database cleanup: PGlite shutdown
can otherwise reset it to zero during local/test execution. Five subprocess tests
now cover argument, configuration and database failures without external access.
New `--dry-run`, `--conversation-id`, and targeted `--queue-only` controls allow
read-only previews and controlled tests. They do not bypass eligibility, read
revalidation, preferences, cooldown or normal authentication.

## Ordered deployment checklist

Commands below are **for a future authorized operator**. Blocks identify where
they run. Do not print environment files, a full Docker inspect, database URLs,
SMTP credentials, bearer tokens, payloads or private message contents. Do not use
shell tracing. The audit itself executed none of the production commands. Steps
1–13 form the activation sequence; the separate rollback section is recovery
guidance, not an additional activation step. Stop if any required check fails.

### 1. Back up before merging or deploying

**Operator workstation with existing GitHub CLI access:** use the existing
restore-tested, encrypted R2 backup workflow. Manual dispatch works even when
scheduled operations are disabled.

```sh
gh workflow run backup.yml --ref main --repo rustedshader/uni-market
gh run list --workflow backup.yml --branch main --event workflow_dispatch \
  --repo rustedshader/uni-market --limit 5
read -r backup_run_id
gh run watch "$backup_run_id" --repo rustedshader/uni-market --exit-status
gh run view "$backup_run_id" --repo rustedshader/uni-market \
  --json workflowName,createdAt,status,conclusion,url
```

Select the specific new run you dispatched, not an older successful run. Require
the **backup job itself** to succeed, its restore/table-count check to pass, and
its encrypted R2 read-back/completion receipt to exist. A successful alert job
alone is insufficient. Record the run URL and matching
`database-backups/<run-id>-<attempt>/` receipt in the private operations record.
Confirm the matching encryption key is recoverable from admin escrow. Follow
[recovery-and-alerts.md](recovery-and-alerts.md) if any prerequisite is missing;
stop the release until the backup succeeds. Never restore onto production as an
activation step.

**Linux host, before the release:** suspend an already installed reminder timer,
allow any running reminder job to finish, and preserve the current image.

```sh
if systemctl cat uni-market-unread-reminders.timer >/dev/null 2>&1; then
  sudo systemctl disable --now uni-market-unread-reminders.timer
fi
while :; do
  state=$(systemctl show uni-market-unread-reminders.service -p ActiveState --value 2>/dev/null || true)
  case "$state" in
    activating|active|deactivating) sleep 5 ;;
    *) break ;;
  esac
done
if sudo docker image inspect uni-market:before-unread-reminders >/dev/null 2>&1; then
  printf '%s\n' 'Existing rollback tag found: review it before replacing it.'
  exit 1
fi
previous_image=$(sudo docker inspect --format '{{.Image}}' uni-market)
sudo docker image tag "$previous_image" uni-market:before-unread-reminders
```

Record that image ID and the pre-release source commit. The separate tag keeps
the image referenced when the deploy script cleans its own rollback tag. Initial
activation has no installed timer; the checks above accommodate later releases.

### 2. Deploy through the existing CI release process

**Operator workstation / repository:** commit and review the complete feature and
audit changes in a PR. Merge using the repository's existing approved process.
A push to `main` automatically deploys after both CI gates; therefore step 1 must
finish **before** the merge. This audit did not commit, push or merge anything.

```sh
gh run list --workflow ci.yml --branch main --repo rustedshader/uni-market --limit 5
read -r release_run_id
gh run watch "$release_run_id" --repo rustedshader/uni-market --exit-status
gh run view "$release_run_id" --repo rustedshader/uni-market \
  --json headSha,status,conclusion,url
```

Select the run for the reviewed release commit. Require quality, isolated
PostgreSQL tests, browser tests, and deployment to succeed. Do not bypass a CI
failure because a local failure was previously described as environmental. The
existing bootstrap fetches `origin/main`, builds Compose and replaces only this
app. No manual `docker compose up`, SSH key change, or production secret edit is
needed. If the actual installed bootstrap or checkout differs, stop and reconcile
it with the responsible operator before using these paths.

### 3. Confirm the container and runtime contract

**Linux host:**

```sh
cd /opt/uni-market/source
git rev-parse HEAD
sudo docker inspect --format 'name={{.Name}} image={{.Image}} workdir={{.Config.WorkingDir}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} health={{.State.Health.Status}}' uni-market
curl --fail --silent --show-error http://127.0.0.1:3020/health
test -x /usr/bin/docker
sudo test -S /var/run/docker.sock
sudo docker --host=unix:///var/run/docker.sock exec --workdir /app uni-market \
  /bin/sh -c 'test "$PWD" = /app && test -x /usr/local/bin/node && test -x /usr/bin/timeout && test -f /app/apps/api/dist/jobs/unread-reminders.js && test -f /app/apps/api/dist/db/migrate.js'
sudo docker exec uni-market /usr/local/bin/node --check /app/apps/api/dist/jobs/unread-reminders.js
```

Expect the reviewed commit, the new image, `/app`, `node`, `readonly=true`,
`health=healthy`, HTTP success, and exit 0 from executable/path checks. The service
uses the conventional **rootful local** Docker socket. A rootless or differently
installed engine requires a reviewed local unit adjustment; do not grant broad
Docker-group access or connect the service to a remote daemon as a workaround.

Container environment validation without printing values:

```sh
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module <<'NODE'
import { loadConfig } from '/app/apps/api/dist/config.js';
try {
  const c = loadConfig();
  if (c.NODE_ENV !== 'production' || c.DEV_MODE || !c.SMTP_HOST || c.DATABASE_URL.startsWith('pglite:')) throw new Error();
  if (new URL(c.CLIENT_URL).origin !== 'https://uni.rocks') throw new Error();
  console.log('Production environment preflight passed; no values displayed');
} catch { console.error('Environment preflight failed; review configuration privately'); process.exitCode = 1; }
NODE
```

### 4. Apply / idempotently confirm migration 0015

The healthy new container has **already run migration at startup**. This explicit
command confirms the same normal migration workflow, serialized with deployment:

**Linux host; Node runs inside the existing container:**

```sh
sudo flock -w 120 /tmp/uni-market-deploy.lock /usr/bin/docker \
  --host=unix:///var/run/docker.sock exec --workdir /app uni-market \
  /usr/local/bin/node /app/apps/api/dist/db/migrate.js
```

Expect exit 0 and no second application of 0015. Do not use `npm run db:migrate`
inside the production image: that source script uses the pruned development
dependency `tsx`. Do not run `drizzle-kit push` or execute migration SQL by hand.
If the container never becomes healthy because migration failed, resolve that
failure before this step; healthy-before-initial-migration is impossible with
the current Docker CMD.

### 5. Verify journal, columns and indexes

**Linux host; read-only checks inside Docker:**

```sh
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
let db;
try {
  db = postgres(process.env.DATABASE_URL, { max: 1 });
  const folder = '/app/apps/api/drizzle';
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8'));
  const entry = journal.entries.find(e => e.tag === '0015_unread_message_reminders');
  if (!entry || journal.entries.at(-1).tag !== entry.tag) throw new Error();
  const hash = createHash('sha256').update(readFileSync(`${folder}/${entry.tag}.sql`)).digest('hex');
  const history = await db`select hash from drizzle.__drizzle_migrations where created_at = ${entry.when}`;
  if (history.length !== 1 || history[0].hash !== hash) throw new Error();
  const columns = await db`select table_name, column_name, is_nullable, data_type from information_schema.columns
    where table_schema = 'public' and (table_name, column_name) in
      (('conversations','last_unread_reminder_through_at'), ('conversations','last_unread_reminder_sent_at'),
       ('email_outbox','reminder_conversation_id'), ('email_outbox','last_attempt_at'))`;
  if (columns.length !== 4 || columns.some(c => c.is_nullable !== 'YES')) throw new Error();
  const indexes = await db`select indexname, indexdef from pg_indexes where schemaname = 'public'
    and indexname in ('email_outbox_pending_reminder_idx','messages_unread_conversation_idx')`;
  if (indexes.length !== 2 || !indexes.every(i => i.indexdef.includes('WHERE'))) throw new Error();
  const foreignKeys = await db`select confdeltype from pg_constraint
    where conname = 'email_outbox_reminder_conversation_id_conversations_id_fk'`;
  if (foreignKeys.length !== 1 || foreignKeys[0].confdeltype !== 'c') throw new Error();
  console.log('0015 journal hash, nullable columns, partial indexes and cascade foreign key verified');
} catch { console.error('Migration verification failed; investigate privately without changing journal rows'); process.exitCode = 1; }
finally { await db?.end(); }
NODE
```

Expected: the verification message, exit 0, exactly one matching journal entry.
This checks 0015 only; later migrations require updating this audited release
procedure instead of ignoring the last-entry guard.

### 6. Validate and install the host units

**Linux host:**

```sh
cd /opt/uni-market/source
systemd-analyze calendar '*-*-* *:00/15:00 UTC'
sudo systemd-analyze verify \
  infra/operations/uni-market-unread-reminders.service \
  infra/operations/uni-market-unread-reminders.timer
sudo install -m 0644 infra/operations/uni-market-unread-reminders.service /etc/systemd/system/
sudo install -m 0644 infra/operations/uni-market-unread-reminders.timer /etc/systemd/system/
```

Expect a next UTC quarter-hour and no unit syntax errors. Resolve incompatible
systemd options on the actual host rather than ignoring warnings. The system
service intentionally runs its Docker client as root against the local Unix
socket, while the exec child retains the container's `node` user. Hardening
restricts host filesystem access, but Docker-daemon access remains powerful;
unit files and source must remain administrator-controlled. Do not put secrets
in a systemd `Environment=` line or unit file.

### 7. Reload systemd

**Linux host:**

```sh
sudo systemctl daemon-reload
sudo systemctl cat uni-market-unread-reminders.service uni-market-unread-reminders.timer
```

Confirm the actual loaded unit matches the reviewed files, including UTC,
`Persistent=true`, in-container timeout, local socket and absolute Node path.
Account for existing drop-ins before proceeding.

### 8. Keep the timer disabled and preview the backlog without delivery

**Linux host:**

```sh
sudo systemctl disable --now uni-market-unread-reminders.timer
systemctl show uni-market-unread-reminders.timer -p ActiveState -p UnitFileState
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --dry-run
```

Expected: `ActiveState=inactive`, `UnitFileState=disabled`, a
`unread_reminders_preview` event, `queued=0`, `sent=0`.
`evaluated` counts up to 1,000 currently queueable conversations, not all historical
messages; `pending` counts due retry jobs. A dry run makes no outbox, receipt or
delivery-marker writes. An existing eligible backlog will be processed after
activation. Review that expected audience and SMTP capacity before the first
full service run. Keep the timer **disabled and inactive throughout steps 8–12**;
do not enable it for boot or run the global service during controlled testing.
Ensure no other operator runs an unscoped reminder command concurrently. If a
controlled check fails, stop the release with the timer still disabled. Only
step 12 may run the first global service, after steps 9–11 pass; only step 13 may
enable and start the timer. Continue these commands in the same operator Bash
session so the two controlled conversation IDs remain available for verification.

### 9. Preview and deliver a reminder to the first controlled conversation

Use two authorized adult student test accounts with controlled inboxes, valid
eligibility and message preferences, no account restrictions and no blocks.
Use an approved active/reserved listing. Create a conversation through the
normal UI and send a buyer message. Record that the normal first-conversation
email arrived. Leave the seller conversation unopened for at least **five real
hours**. Choose a fresh conversation with no previous reminder job or successful
reminder cycle. Do not backdate production rows or expose a fake clock in the CLI.

Copy only the controlled conversation UUID from its normal Chats URL.

**Linux host:**

```sh
read -r controlled_conversation_id
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --dry-run --conversation-id "$controlled_conversation_id"
```

Require exit 0, `evaluated=1`, `pending=0`, `queued=0`, `sent=0` for this fresh
eligible test conversation. A dry run lists queueable candidates and counts due
pending jobs; it does not revalidate an existing pending job for delivery.
`evaluated=0` alone does not prove a conversation is ineligible: a previous
dedupe key or pending job can also exclude it. If the expected fresh state is
absent, inspect the metadata using step 11 and resolve it before sending.

Only after the controlled preview passes, execute the targeted real command:

```sh
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --conversation-id "$controlled_conversation_id"
```

Require exit 0 and `sent=1`. Repeat that same targeted command once and require
`sent=0` for the unchanged state. No global reminder service has run yet.
`--conversation-id` scopes both queueing and due-job processing; it uses the
normal eligibility query, durable outbox, row lock, read-status revalidation,
SMTP delivery and successful cycle/cooldown updates. It does not force a send,
shorten the five-hour rule, clear dedupe state, bypass preferences, or override
the 24-hour cooldown. If state changes after preview, a zero send or suppression
can be correct, but it is not a passed real-delivery test; resolve it before
continuing. Record the structured CLI output and delivery result privately.

Do not open the seller chat until the reminder has arrived. Verify its email and
link in step 11. Normal initial email policy remains once per conversation. A
genuinely new reminder needs a new buyer message, its own five hours, and 24 hours
since the last successful reminder.

### 10. Queue the second controlled conversation and verify read suppression

Prepare a **second** controlled conversation with an incoming message unread for
five hours, no previous reminder job and no successful reminder cycle. It must
have a different UUID from the first test and meet the same eligibility checks.
Both conversations can be prepared while the timer is disabled; no global run
should consume either test's pending job.

**Linux host:**

```sh
read -r read_test_conversation_id
if [ -z "$controlled_conversation_id" ] || [ "$read_test_conversation_id" = "$controlled_conversation_id" ]; then
  printf '%s\n' 'Use two distinct controlled conversation IDs from the same operator session.' >&2
  exit 1
fi
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --dry-run --conversation-id "$read_test_conversation_id"
```

Require the same fresh eligible preview as step 9. Then queue only that target:

```sh
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --queue-only --conversation-id "$read_test_conversation_id"
```

Require exit 0, `queued=1`, `pending=1`, `sent=0`; this command uses normal
eligibility and deduplication to create the durable pending job, then returns
before SMTP. It does not force an ineligible conversation into the outbox.
Open that conversation as its seller in the normal UI and
verify its unread badge clears, including in another signed-in tab. Then:

```sh
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --conversation-id "$read_test_conversation_id"
```

Require exit 0, `skipped=1`, `sent=0`, with the outbox record suppressed as
`reminder:no-longer-eligible`; the listing/title/payload are not logged. If zero
was queued initially, check age, lifecycle, preferences, previous reminder state
and target membership instead of forcing eligibility. `--queue-only` requires a
UUID target and cannot be combined with `--dry-run`.

### 11. Verify controlled logs, outbox state, email links and monitoring

Keep the timer disabled and do not run the global service yet. Require all of
the following before step 12:

- The first targeted run logged a successful send, its unchanged-state rerun
  sent zero, and the controlled inbox received exactly one reminder.
- The second test logged queue-only without delivery, then suppression after
  reading, with no reminder received in that controlled inbox.
- The delivered email has the correct listing title, HTML/plain-text content and
  protected `/marketplace/chats/:id` link. Check sign-in return when logged out
  and membership protection. Open the first seller chat only after receipt.
- Outbox metadata confirms the successful first delivery and suppressed second
  job; no unresolved delivery error remains in the controlled tests.

Direct `docker exec` CLI events appear in the operator terminal; they are not
systemd service invocations and must not be claimed as service journal evidence.
Keep their non-sensitive counts/job IDs and UTC timestamps in the release record.
Inspect only non-sensitive metadata for both controlled conversations:

```sh
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module - "$controlled_conversation_id" "$read_test_conversation_id" <<'NODE'
import postgres from 'postgres';
import { z } from 'zod';
let db;
try {
  db = postgres(process.env.DATABASE_URL, { max: 1 });
  const ids = z.array(z.uuid()).length(2).parse(process.argv.slice(2));
  if (ids[0] === ids[1]) throw new Error();
  const rows = await db`select id, reminder_conversation_id, attempts, last_attempt_at, available_at, sent_at, failed_at, suppressed_at, suppression_reason
    from email_outbox where template = 'unread-message-reminder'
      and reminder_conversation_id in (${ids[0]}, ${ids[1]}) order by created_at`;
  const delivered = rows.filter(row => row.reminder_conversation_id === ids[0] && row.sent_at && !row.failed_at && !row.suppressed_at);
  const suppressed = rows.filter(row => row.reminder_conversation_id === ids[1] && !row.sent_at && !row.failed_at
    && row.suppressed_at && row.suppression_reason === 'reminder:no-longer-eligible' && row.attempts === 0);
  console.log(JSON.stringify(rows));
  if (rows.length !== 2 || delivered.length !== 1 || suppressed.length !== 1) throw new Error();
} catch { console.error('Controlled-job metadata check failed'); process.exitCode = 1; }
finally { await db?.end(); }
NODE
```

#### Check retry/failure monitoring before the global run

The automated isolated tests cover transient SMTP failure, backoff, a stable
Message-ID, terminal failure at attempt five, read/opt-out suppression on retry,
restart persistence and concurrent claims. Do not break real SMTP settings or
send deliberately failing production mail to repeat those tests. Use an isolated
provider sandbox if an end-to-end negative-delivery drill is required.

**Linux host:** check existing protected aggregate monitoring using the token
already inside the container, without exposing it as a shell argument:

```sh
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module <<'NODE'
try {
  if (!process.env.MONITORING_TOKEN) throw new Error();
  const response = await fetch('http://127.0.0.1:4000/api/internal/operations', {
    headers: { authorization: `Bearer ${process.env.MONITORING_TOKEN}` }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error();
  const data = await response.json();
  if (!data.database?.ok) throw new Error();
  console.log(JSON.stringify({ databaseOk: true, email: data.database.email }));
} catch { console.error('Private aggregate monitoring check failed; inspect configuration privately'); process.exitCode = 1; }
NODE
```

Expected: database OK and aggregate pending/failed/oldest-pending counters. These
queries include reminder outbox rows. Existing operations monitoring alerts on
pending age over 15 minutes and terminal failures in the last 24 hours, if that
workflow and its token are configured. `operationalMetrics` counters are
**process-local**: reminder CLI counters are not shared with the API's memory.
The durable outbox counters and systemd exit/journal are the relevant signals.
The CLI's `sent`, `skipped` and `failed` completion counts describe only that
invocation's bounded batch. Its `pending` counter is populated only by dry-run
and queue-only modes; `pending=0` in a normal delivery completion event is not
proof that the entire queue is empty. Use the database-backed probe for backlog
counts and the following read-only query for specific reminder jobs.

**Linux host; read-only metadata inside Docker:** run this before activation,
after the first global run, or while investigating a failure. It returns up to
25 pending jobs and 25 terminal failures, including retries whose `available_at`
is still in the future. It does not print recipients, payloads, message bodies,
connection strings or provider error text, and does not modify any job.

```sh
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module <<'NODE'
import postgres from 'postgres';
let db;
try {
  db = postgres(process.env.DATABASE_URL, { max: 1 });
  const pending = await db`select id, reminder_conversation_id, attempts, last_attempt_at, available_at, created_at
    from email_outbox where template = 'unread-message-reminder'
      and sent_at is null and suppressed_at is null and failed_at is null
    order by available_at, id limit 25`;
  const failed = await db`select id, reminder_conversation_id, attempts, last_attempt_at, failed_at
    from email_outbox where template = 'unread-message-reminder'
      and sent_at is null and suppressed_at is null and failed_at is not null
    order by failed_at desc, id limit 25`;
  console.log(JSON.stringify({ pending, failed }));
} catch { console.error('Reminder queue metadata check failed; investigate privately'); process.exitCode = 1; }
finally { await db?.end(); }
NODE
```

Rows here are a bounded sample, not queue totals. Reconcile unresolved failures
and pending age with the aggregate probe and the job's last structured event;
do not delete or reset jobs just to clear a monitoring result.

The API probe cannot detect a never-enabled reminder timer that has never queued
anything. Assign an operator to check timer liveness and recent journal runs;
this feature does not add a separate host paging agent.

When a controlled failure occurs, inspect the CLI output and controlled-job
metadata above; the query prints safe metadata before failing its success gate.
For service failures, inspect `Result`/`ExecMainStatus` and bounded journal logs,
then follow [Rollback and recovery](#rollback-and-recovery) before changing any
outbox state. Scheduled retries wait
2/4/8/16 minutes, rounded to the next scheduled check. Five failed attempts
become terminal; failures return nonzero. Verify existing external operations
notifications separately through the operations runbook. Do not assume SMTP
acceptance means inbox delivery; examine the controlled inbox/provider record.

Before activation, retry only the intended controlled conversation with the
targeted command after its backoff expires; do not run the global service to
retry a controlled test. A failed controlled test keeps the release blocked and
the timer disabled until the relevant checks in steps 9–11 pass.

### 12. Execute the first global reminder service after controlled checks pass

Proceed only after **all steps 9–11 have passed**. Keep the timer disabled and
inactive during this manual global run. Preview the current backlog again,
because it may have changed during the controlled tests (**Linux host**):

```sh
sudo docker exec --workdir /app uni-market /usr/local/bin/node \
  /app/apps/api/dist/jobs/unread-reminders.js --dry-run
```

Review the expected audience and SMTP capacity. This preview sends nothing. Only
after that review, start the real global service for the first time:

```sh
sudo systemctl start uni-market-unread-reminders.service
systemctl show uni-market-unread-reminders.service \
  -p ActiveState -p Result -p ExecMainStatus
sudo journalctl -u uni-market-unread-reminders.service --since '30 minutes ago' --no-pager
systemctl show uni-market-unread-reminders.timer -p ActiveState -p UnitFileState
```

This unscoped job can send to **all currently eligible sellers**, including old
messages. Require `Result=success`, `ExecMainStatus=0`, started/completed journal
events with expected counts, and a still-disabled/inactive timer. A successful
oneshot normally returns to `inactive`; that is not an error. The unchanged first
test must not be reminded again, and the read/suppressed second test must not be
sent. The global run uses the same eligibility, deduplication and read checks as
targeted runs.

A delivery failure exits 1 and persists backoff or terminal state. In-container
timeout normally exits 124, or 137 if forced to KILL. Keep the timer disabled and
use [Rollback and recovery](#rollback-and-recovery) if the first global run fails;
do not repeat runs merely to hide an
error. Output from this systemd invocation is in the service journal, not
reliably in `docker logs` for the main API. Record the first global result before
continuing.

### 13. Enable and start the timer only after the first global run succeeds

After the controlled checks and first global service run pass, enable the timer
and verify its next scheduled execution (**Linux host**):

```sh
if [ "$(systemctl show uni-market-unread-reminders.service -p Result --value)" != success ] ||
   [ "$(systemctl show uni-market-unread-reminders.service -p ExecMainStatus --value)" != 0 ]; then
  printf '%s\n' 'Do not activate: the first global reminder service must succeed.' >&2
  exit 1
fi
sudo systemctl enable --now uni-market-unread-reminders.timer
systemctl is-enabled uni-market-unread-reminders.timer
systemctl list-timers --all uni-market-unread-reminders.timer
systemctl is-active uni-market-unread-reminders.timer
systemctl show uni-market-unread-reminders.timer -p LastTriggerUSec -p NextElapseUSecRealtime
```

Require `enabled`, `active`, and a next UTC quarter-hour execution with the
configured jitter. `Persistent=true` may immediately catch up a missed
activation once when the timer starts; it does not replay one email for every
missed quarter-hour. Existing durable cycle/cooldown checks still prevent
reminding the same unchanged test state again. Record the actual next execution
and monitor the first timer-triggered service result.

## Rollback and recovery

**First disable future reminder work; keep the API running:**

```sh
sudo systemctl disable --now uni-market-unread-reminders.timer
```

This does not cancel an already running SMTP call or oneshot. Drain the service
using the state loop from step 1 before replacing the image. Also ensure every
directly invoked targeted CLI command has finished: those processes are not
tracked by the systemd service's state. Avoid killing only the Docker client and
assuming its container worker stopped. The unit's in-container timeout bounds
jobs launched through the service, not the direct controlled CLI commands.
A hard kill during SMTP creates an ambiguous delivery; investigate before retrying.

If activation fails during steps 9–11, keep the timer disabled and do not proceed
to the first global run in step 12. If step 12 fails, keep the timer disabled and
resolve that global failure before step 13. Do not enable a timer as a rollback
or as a way to retry an unfinished controlled test.

**Reminder-only rollback:** leave the timer disabled and keep the new application
running. Ordinary chat and first-message email continue; the general email worker
explicitly excludes reminder jobs. Preserve all pending/sent/suppressed/failed
outbox rows and conversation cycle markers.

**Whole-image rollback:** the pre-feature image predates reminder rows and does
not exclude the new template from its generic worker. It could deliver pending
reminders without read revalidation. Prefer reminder-only rollback. The command
below refuses whole-image rollback while any unsent, unsuppressed, nonterminal
reminder exists, including future retry jobs. Do not remove this guard. A
controlled `--queue-only` job is also pending until it has been suppressed or
otherwise resolved, so this guard applies even before the first global run. A
necessary operational cancellation must be separately reviewed: suppress pending
rows with an operational reason, retaining their dedupe records; never delete
them or fabricate `sent_at`. Only after resolving them, draining the service,
and pausing competing CI/manual deployments, run this on the **Linux host**:

```sh
set -e
cd /opt/uni-market/source
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module <<'NODE'
import postgres from 'postgres';
let db;
try {
  db = postgres(process.env.DATABASE_URL, { max: 1 });
  const [row] = await db`select count(*)::int as pending from email_outbox
    where template = 'unread-message-reminder' and sent_at is null and suppressed_at is null and failed_at is null`;
  if (row.pending !== 0) throw new Error();
  console.log('Old-image rollback guard passed: no claimable reminder jobs');
} catch { console.error('Whole-image rollback refused; retain the new app with its timer disabled'); process.exitCode = 1; }
finally { await db?.end(); }
NODE
sudo docker image inspect uni-market:before-unread-reminders --format '{{.Id}}'
sudo flock -w 120 /tmp/uni-market-deploy.lock /bin/sh -c '
  cd /opt/uni-market/source &&
  /usr/bin/docker image tag uni-market:before-unread-reminders uni-market:production &&
  /usr/bin/docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build app
'
sudo docker inspect --format '{{.State.Health.Status}}' uni-market
curl --fail --silent --show-error http://127.0.0.1:3020/health
```

Allow the normal health grace period; the last two commands must eventually
report healthy/HTTP success. Do not rebuild the new source during rollback, run
the current bootstrap (which fetches `main`), or prune images/volumes. Reconcile
the release source/CI state before the next deployment so it does not immediately
replace the rollback. A schema rollback alone would not make an old worker safe
with new template rows; the guard is required even though schema changes are
additive.

**Migration rollback:** no down-migration workflow exists. Retain the additive
columns/indexes and journal entry when rolling the application back. The previous
schema can coexist with these nullable additions. Never drop message/outbox
tables, delete migration journal entries or restore a backup over current live
data merely to disable reminders. Actual disaster recovery is a separate,
explicitly reviewed incident procedure in the recovery runbook.

**Recover one terminal failed reminder:** stop/drain the timer first, inspect its
metadata and SMTP provider records, and confirm a previous send was rejected.
An SMTP timeout/accepted-but-uncommitted result is ambiguous; a retry can duplicate
it. Reset only the existing failed row, never a sent/suppressed job or its dedupe
key. The following bounded command fails if a competing pending job exists and
retains the delivery snapshot and successful cooldown markers:

```sh
read -r failed_reminder_job_id
sudo docker exec -i --workdir /app uni-market /usr/local/bin/node --input-type=module - "$failed_reminder_job_id" <<'NODE'
import postgres from 'postgres';
import { z } from 'zod';
let db;
try {
  db = postgres(process.env.DATABASE_URL, { max: 1 });
  const id = z.uuid().parse(process.argv[2]);
  const changed = await db.begin(async tx => {
    const rows = await tx`select id from email_outbox where id = ${id} and template = 'unread-message-reminder'
      and failed_at is not null and sent_at is null and suppressed_at is null for update`;
    if (rows.length !== 1) throw new Error();
    return await tx`update email_outbox set failed_at = null, attempts = 0, available_at = clock_timestamp()
      where id = ${id} returning id`;
  });
  if (changed.length !== 1) throw new Error();
  console.log('Existing failed reminder reset; dedupe and cycle state preserved');
} catch { console.error('Recovery refused or failed; no competing job or delivery history should be removed'); process.exitCode = 1; }
finally { await db?.end(); }
NODE
```

Run the conversation-scoped normal command from step 9. It still revalidates
read status, preferences, account/listing access, prior cycle and cooldown.
Reading or opting out while the worker was stopped can cause suppression rather
than another send, which is correct. After remediation, reset a failed service
status without activating the timer:

```sh
sudo systemctl reset-failed uni-market-unread-reminders.service
```

For an initial activation, finish or repeat any failed controlled check (using a
fresh eligible conversation if required), confirm the step 11 results, and follow
steps 12–13. An existing retry may appear as `pending=1`, `evaluated=0` in a scoped
preview; its delivery still uses normal revalidation. Do not require requeueing
that job or bypass its backoff. Only for a **previously activated installation**
whose controlled checks and first global run already passed, after confirming
the incident and targeted retry are resolved, re-enable normal scheduling:

```sh
sudo systemctl enable --now uni-market-unread-reminders.timer
systemctl list-timers --all uni-market-unread-reminders.timer
```

## Residual limits and activation sign-off

- SMTP has no provider idempotency API. Stable Message-ID and database locks
  prevent ordinary concurrent duplicates but cannot guarantee exactly-once
  external delivery after a crash, timeout or database failure following SMTP
  acceptance. A read during the SMTP call also cannot retract an accepted email.
- Production table sizes/grants, deployed commit, installed systemd version,
  Docker socket/paths, unit drop-ins, backup freshness, SMTP deliverability and
  actual timer activation were not checked remotely. The operator checks above
  remain mandatory.
- Local PostgreSQL concurrency validation is skipped if `TEST_POSTGRES_URL` is
  absent; the existing CI job provides an isolated PostgreSQL 18 database. Require
  that CI run before activation. Never point tests at production.
- The earlier local Node 26/jsdom AbortSignal mismatch in the unsaved-changes
  unit test was corrected by pairing Node's Request with native signal
  constructors in that test. Its navigation assertions and application component
  are unchanged. CI uses Node 22; its quality gate still must pass.
- A quarter-hour schedule is periodic, not exact delivery at five hours. Backlog,
  SMTP retry, host downtime, the 100-delivery batch cap and persistent catch-up can
  add delay. Review pending age and capacity as usage grows.
- Existing chat routes also require current marketplace eligibility. Onboarded,
  eligible users return to the requested chat after sign-in; users whose student
  verification or policy acceptance has expired follow the existing Settings
  verification flow. The audit does not change those authentication rules.

Only record **active in production** after the release, verified migration,
controlled real reminder, read suppression, result verification, first successful
global service run and timer status checks actually succeed, in that order.
Keep the backup/release run IDs, non-sensitive verification results,
UTC timestamps, operator and rollback image reference in the private release log.

References for runtime semantics: [Docker exec](https://docs.docker.com/reference/cli/docker/container/exec/),
[systemd.timer](https://www.freedesktop.org/software/systemd/man/256/systemd.timer.html),
[systemd.service](https://www.freedesktop.org/software/systemd/man/256/systemd.service.html).

## Audit verification and changed files

Application validation results below are from the production-readiness audit,
on local Windows with Node 26.7.0. The final documentation-only sequencing review
edited **only this runbook**: it verified the actual CLI read-only, kept the timer
disabled through controlled tests and the first global run, moved global delivery
to step 12 and timer activation to step 13, and reconciled rollback/recovery
references. It reran offline syntax/order checks, not application tests. Checksums
confirmed that all 310 other repository files were unchanged. No production
command, email send, migration or timer activation was executed during this review.

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed in all workspaces |
| `npm run build` | Passed; existing Vite chunk-size advisory remains |
| Reminder integration + migration audit | 27 passed across two files, using isolated migrated PGlite |
| Badge, login-routing, email-worker and CLI unit suites | 17 passed across four files |
| Known unsaved-changes unit test | Still fails with the same jsdom/Node AbortSignal mismatch; test and component have no diff against HEAD. No test was weakened |
| Browser suite | 38 passed, 2 Turnstile cases skipped because no test site key was configured |
| `npm run test:postgres` | 14 skipped: no isolated `TEST_POSTGRES_URL`; Docker Desktop Linux engine unavailable |
| Drizzle schema/snapshot generation check | No schema changes, nothing to migrate; no additional migration generated |
| Migration replay | Populated 0014 upgraded to 0015, existing data preserved, second run kept the same hash/timestamp history |
| Runbook syntax | 26 Bash blocks and 7 Node heredocs checked offline without executing their commands; all 13 activation steps numbered correctly, with separate rollback guidance and controlled/global/timer order verified |
| Compiled CLI failure probes | Unknown flag, invalid target, unscoped queue-only, missing SMTP and unmigrated isolated database all return exit 1 after cleanup |
| Host systemd/runtime checks | Not run on Windows; production host validation and actual PostgreSQL/SMTP behavior remain operator/CI gates |
| Production execution | None: no SSH, production database connections, migrations, container changes, timer activation, environment changes or real emails |

The feature was already an uncommitted working-tree change when the original
production-readiness audit started. The following **12 files were created or
edited by that earlier audit**; the final sequencing review changed only this
runbook. Earlier
feature files and migration 0015 were preserved, and nothing was committed or
pushed:

| File | Audit change |
| --- | --- |
| `apps/api/src/services/unread-reminders.ts` | Exact timestamp snapshot, read-only/scoped/queue-only controls, visible disabled-state failure |
| `apps/api/src/jobs/unread-reminders.ts` | Strict CLI options, sanitized setup/cleanup errors, reliable final exit code |
| `infra/operations/uni-market-unread-reminders.service` | Absolute paths, local Docker socket, inherited working directory/environment, in-container timeout and host hardening |
| `infra/operations/uni-market-unread-reminders.timer` | Explicit UTC quarter-hours |
| `apps/web/src/components/ChatUnreadBadge.tsx` | Abort signal for obsolete count requests |
| `apps/web/src/components/NotificationUpdates.tsx` | Clears the previous account's unread query on a direct account switch |
| `tests/integration/unread-reminders.test.ts` | Preview, scope, queue/read suppression, precise snapshot and disabled-state tests |
| `tests/integration/unread-reminder-migration.test.ts` | Additive 0014 upgrade, replay safety, journal/snapshot/column/index checks |
| `tests/unit/chat-unread-badge.test.tsx` | Reconnect, visibility, disconnected fallback and in-flight account-switch tests |
| `tests/unit/unread-reminder-cli.test.ts` | Five actual isolated subprocess failure/exit checks |
| `docs/unread-reminders.md` | Corrected runtime/migration/timeout guidance and links to this runbook |
| `docs/unread-reminders-deployment.md` | This audit, ordered activation, verification, recovery and guarded rollback |

The final operator-handoff review reread both reports and the actual CLI,
revalidated the 13-step activation order and rollback constraints, and reran the
27 reminder/migration and 17 relevant unit tests (including five CLI argument/error
tests); all passed. Fixtures used only isolated in-memory databases and mocked
SMTP. Application code and test files were unchanged. The offline syntax/order
results above were refreshed; earlier browser/full-suite results remain historical
and were not rerun for this documentation handoff. No production confirmation
below has been performed or prefilled.

## Final local release validation (13 November 2026)

The historical audit results above are superseded for local release checks by
the following results on Windows with Node 26.7.0, after a clean `npm ci` using
the final lockfile. The earlier unsaved-changes test failure was resolved by
using native AbortSignal constructors in its setup; no assertion was removed.
Production dependency security fixes include Nodemailer 10.5, supported by the
deployment's Node 22 runtime, and compatible updates to the other affected
packages. These changes were retested together with the feature.

| Check | Final local result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed in every workspace |
| `npm run build` | Passed; Vite chunk-size and third-party Zod comment-annotation advisories remain |
| Full unit suite, `--no-file-parallelism` | 188 passed across 50 files, including all five CLI failure/exit tests |
| Full integration suite, `--no-file-parallelism` | 231 passed across 19 files, including 28 reminder tests and migration replay |
| Full browser suite | 40 passed, none skipped, using the CI public Turnstile test key and isolated local servers |
| `npm audit --omit=dev --audit-level=high` | Passed; zero reported production dependency vulnerabilities |
| Runbook syntax and order | 26 Bash blocks and 7 Node snippets passed offline syntax validation; 13 ordered activation steps and 8 unchecked sign-offs verified |
| Patched Nodemailer transport smoke check | HTML/plain-text message and stable Message-ID generated entirely in memory; no SMTP connection or email delivery |
| `npm run test:postgres` | 14 skipped; no isolated `TEST_POSTGRES_URL`, and Docker Desktop's Linux engine is stopped |
| Container backup/restore smoke test | Not run locally because the Docker engine is unavailable; remains mandatory in CI |

The payload review confirmed that the existing outbox has both required JSONB
`payload` and nullable encrypted `encrypted_payload` columns. Reminder metadata
uses the established user-email payload convention. Added integration checks
reload the snapshot through SQL and Drizzle, verify mocked SMTP delivery and
read suppression, preserve metadata across retries, and check encryption for
sensitive direct-email jobs. No payload-storage application defect was found
and no new storage mechanism was introduced.

Local validation did not access production, send real emails or activate a
timer. A push to `main` starts the existing CI release pipeline; require its
quality, isolated PostgreSQL, browser, backup/restore and deployment checks.
This local result does not complete any production activation sign-off below.

## Production Activation Sign-off

Complete manually, in order, only after authorized production execution. Keep
evidence in the private release log and enter only non-sensitive references here.
All confirmation boxes are intentionally unchecked; this form does not indicate
that the feature is live.

- [ ] **Backup confirmed:** successful restore-tested backup run, matching encrypted receipt and recoverable key escrow. Evidence/reference: __________
- [ ] **CI deployment confirmed:** reviewed commit and successful quality, isolated PostgreSQL, browser and deployment jobs; healthy intended image. Commit/run/image reference: __________
- [ ] **Migration verified:** 0015 journal hash, nullable columns, partial indexes and foreign key confirmed using the serialized procedure. Evidence/reference: __________
- [ ] **Controlled delivery confirmed:** step 9 preview passed, one targeted reminder received, unchanged-state rerun sent zero, protected email link verified. Controlled conversation/evidence reference: __________
- [ ] **Read suppression confirmed:** second conversation queued without SMTP, seller read it, pending reminder suppressed with no reminder sent. Controlled conversation/evidence reference: __________
- [ ] **Logs, outbox and monitoring confirmed:** controlled outcomes and sent/skipped/failed counts checked; pending/failed metadata and monitoring reviewed with no unresolved release blocker. Evidence/reference: __________
- [ ] **First global service succeeded:** step 12 completed after all controlled checks; `Result=success`, `ExecMainStatus=0`, journal and outbox state reviewed while timer remained disabled. Invocation/UTC/evidence reference: __________
- [ ] **Timer activated and next run verified:** step 13 completed last; timer enabled/active, next scheduled execution recorded and first timer-triggered result reviewed. Next run UTC/result reference: __________

**Final operator:** __________

**Completion date/time (UTC):** __________

**Final result:** __________

**Remaining blockers/incidents or exceptions:** __________

**Retained rollback image reference:** __________

**Private release evidence reference:** __________
