import { and, asc, eq, isNull, lte, sql, type SQL } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { conversations, emailOutbox, listings, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { renderEmail } from './email-templates.js';
import { operationalMetrics } from './operational-metrics.js';

const template = 'unread-message-reminder';
const batchSize = 100;

// Use the existing message-level read position. A successful delivery covers
// every message present at queue time; only later incoming messages start a cycle.
function unreadCondition(now: SQL, through?: string): SQL {
  return sql`m.conversation_id = ${conversations.id}
    and m.sender_id = ${conversations.buyerId}
    and m.read_at is null and m.deleted_at is null
    and (${conversations.lastUnreadReminderThroughAt} is null
      or m.created_at > ${conversations.lastUnreadReminderThroughAt})
    and m.created_at <= ${now} - interval '5 hours'
    ${through ? sql`and m.created_at <= ${through}::timestamptz` : sql``}`;
}

function eligible(now: SQL, through?: string): SQL {
  return sql`${users.deletedAt} is null and ${users.closedAt} is null and ${users.suspendedAt} is null
    and ${users.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and ${listings.deletedAt} is null and ${listings.moderationState} = 'APPROVED'
    and ${listings.lifecycleState} in ('ACTIVE', 'RESERVED')
    and (${conversations.lastUnreadReminderSentAt} is null
      or ${conversations.lastUnreadReminderSentAt} <= ${now} - interval '24 hours')
    and exists (select 1 from messages m where ${unreadCondition(now, through)})
    and exists (select 1 from users buyer where buyer.id = ${conversations.buyerId}
      and buyer.deleted_at is null and buyer.closed_at is null and buyer.suspended_at is null)
    and not exists (select 1 from blocks b where
      (b.blocker_id = ${conversations.buyerId} and b.blocked_id = ${conversations.sellerId})
      or (b.blocker_id = ${conversations.sellerId} and b.blocked_id = ${conversations.buyerId}))
    and not exists (select 1 from email_preferences p where p.user_id = ${conversations.sellerId}
      and (not p.enabled or not p.message_updates))`;
}

export class UnreadReminderJob {
  constructor(private db: Database, private config: AppConfig) {}

  // The optional clock is used by tests; production always uses the database clock.
  async runOnce(clock?: Date, options: { dryRun?: boolean; queueOnly?: boolean; conversationId?: string } = {}) {
    if (options.conversationId) z.uuid().parse(options.conversationId);
    if (options.queueOnly && (!options.conversationId || options.dryRun)) throw new Error('Queue-only requires a conversation and cannot be combined with dry-run');
    const now = clock ? sql`${clock.toISOString()}::timestamptz` : sql`clock_timestamp()`;
    const stats = { evaluated: 0, pending: 0, queued: 0, sent: 0, skipped: 0, failed: 0 };
    logger.info({ event: 'unread_reminders_started', dryRun: Boolean(options.dryRun), targeted: Boolean(options.conversationId) }, 'Unread reminder job started');
    if (!this.config.SMTP_HOST || this.config.DEV_MODE) {
      logger.warn({ event: 'unread_reminders_disabled' }, 'Unread reminders require SMTP and DEV_MODE=false');
      throw new Error('Unread reminders require SMTP and DEV_MODE=false');
    }
    const transport = options.dryRun || options.queueOnly ? undefined : nodemailer.createTransport({ host: this.config.SMTP_HOST, port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE, auth: this.config.SMTP_USER ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });

    // Keyset pagination bounds each database query. The host scheduler runs this
    // finite task independently of API traffic and restarts it after host reboots.
    let cursor: string | undefined;
    const trigger = sql<string>`(select m.id from messages m where ${unreadCondition(now)} order by m.created_at, m.id limit 1)`;
    for (let page = 0; page < 10; page++) {
      const candidates = await this.db.select({ id: conversations.id, sellerId: conversations.sellerId,
        listingTitle: listings.title, through: sql<string>`${now}::text`,
        trigger,
      }).from(conversations).innerJoin(users, eq(users.id, conversations.sellerId))
        .innerJoin(listings, eq(listings.id, conversations.listingId))
        .where(and(eligible(now), options.conversationId ? eq(conversations.id, options.conversationId) : undefined,
          cursor ? sql`${conversations.id} > ${cursor}::uuid` : undefined,
          sql`not exists (select 1 from email_outbox prior where prior.dedupe_key =
            ${template} || ':' || ${conversations.id}::text || ':' || (${trigger})::text)`,
          sql`not exists (select 1 from email_outbox e where e.reminder_conversation_id = ${conversations.id}
            and e.sent_at is null and e.failed_at is null and e.suppressed_at is null)`))
        .orderBy(asc(conversations.id)).limit(batchSize);
      if (!candidates.length) break;
      stats.evaluated += candidates.length;
      for (const candidate of candidates) {
        if (options.dryRun) continue;
        const inserted = await this.db.insert(emailOutbox).values({ recipientUserId: candidate.sellerId,
          reminderConversationId: candidate.id, template,
          payload: { conversationId: candidate.id, listingTitle: candidate.listingTitle, through: candidate.through },
          dedupeKey: `${template}:${candidate.id}:${candidate.trigger}`,
        }).onConflictDoNothing().returning({ id: emailOutbox.id });
        stats.queued += inserted.length;
      }
      cursor = candidates.at(-1)!.id;
      if (candidates.length < batchSize) break;
    }

    const pending = and(eq(emailOutbox.template, template), isNull(emailOutbox.sentAt),
      isNull(emailOutbox.failedAt), isNull(emailOutbox.suppressedAt), lte(emailOutbox.availableAt, now),
      options.conversationId ? eq(emailOutbox.reminderConversationId, options.conversationId) : undefined);
    if (options.dryRun || options.queueOnly) {
      const [row] = await this.db.select({ count: sql<number>`count(*)` }).from(emailOutbox).where(pending);
      stats.pending = Number(row?.count ?? 0);
      logger.info({ event: options.queueOnly ? 'unread_reminders_queued_only' : 'unread_reminders_preview', ...stats, candidateLimit: batchSize * 10 },
        options.queueOnly ? 'Targeted reminder queued without delivery' : 'Read-only reminder preview; no jobs queued or delivered');
      return stats;
    }

    // One row lock remains held until SMTP and its durable result are recorded.
    // Unlike a time-limited lease, a slow batch cannot be reclaimed by a peer.
    // Concurrent schedulers skip locked rows; a crashed process releases its lock.
    for (let count = 0; count < batchSize; count++) {
      const processed = await this.db.transaction(async (tx) => {
        const [job] = await tx.select().from(emailOutbox).where(pending)
          .orderBy(asc(emailOutbox.availableAt), asc(emailOutbox.id)).limit(1).for('update', { skipLocked: true });
        if (!job) return false;
        const payload = job.payload as Record<string, unknown>;
        // Preserve PostgreSQL microseconds: converting this snapshot to a JS
        // Date would truncate it and could requalify an already covered message.
        const through = typeof payload.through === 'string' ? payload.through : '';
        const [candidate] = Number.isFinite(Date.parse(through)) && job.reminderConversationId
          ? await tx.select({ email: users.email, displayName: users.displayName, listingTitle: listings.title })
            .from(conversations).innerJoin(users, eq(users.id, conversations.sellerId))
            .innerJoin(listings, eq(listings.id, conversations.listingId))
            .where(and(eq(conversations.id, job.reminderConversationId), eq(conversations.sellerId, job.recipientUserId!), eligible(now, through))).limit(1)
          : [];
        if (!candidate || !z.email().safeParse(candidate.email).success) {
          await tx.update(emailOutbox).set({ suppressedAt: now, suppressionReason: 'reminder:no-longer-eligible' }).where(eq(emailOutbox.id, job.id));
          stats.skipped++;
          return true;
        }
        const attempts = job.attempts + 1;
        await tx.update(emailOutbox).set({ attempts, lastAttemptAt: now, lastError: null }).where(eq(emailOutbox.id, job.id));
        try {
          await transport!.sendMail({ from: `"${this.config.SMTP_FROM_NAME}" <${this.config.SMTP_FROM_EMAIL}>`, to: candidate.email,
            // Stable across retries. SMTP receivers may deduplicate this ID,
            // but SMTP cannot guarantee exactly-once acceptance after a crash.
            messageId: `<unread-${job.id}@${this.config.SMTP_FROM_EMAIL.split('@')[1]}>`,
            ...renderEmail({ template, payload: { ...payload, conversationId: job.reminderConversationId, listingTitle: candidate.listingTitle }, displayName: candidate.displayName, config: this.config }),
          });
        } catch {
          // Do not persist raw SMTP errors: provider responses can contain PII.
          await tx.update(emailOutbox).set({ lastError: 'SMTP delivery failed',
            ...(attempts >= 5 ? { failedAt: now } : { availableAt: sql`${now} + ${2 ** attempts} * interval '1 minute'` }),
          }).where(eq(emailOutbox.id, job.id));
          stats.failed++;
          operationalMetrics.record('email_delivery', false);
          logger.warn({ event: 'unread_reminder_failed', jobId: job.id, attempts }, 'Unread reminder delivery failed');
          return true;
        }
        // Keep database failures outside the SMTP catch: a successful provider
        // acceptance followed by a DB failure is an ambiguous delivery, not a rejection.
        await tx.update(emailOutbox).set({ sentAt: now }).where(eq(emailOutbox.id, job.id));
        await tx.update(conversations).set({ lastUnreadReminderThroughAt: sql`${through}::timestamptz`, lastUnreadReminderSentAt: now })
          .where(eq(conversations.id, job.reminderConversationId!));
        stats.sent++;
        operationalMetrics.record('email_delivery', true);
        return true;
      });
      if (!processed) break;
    }
    logger.info({ event: 'unread_reminders_completed', ...stats }, 'Unread reminder job completed');
    return stats;
  }
}
