import { and, asc, eq, isNull, lte, ne } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox, emailPreferences, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { decryptText } from '../lib/crypto.js';
import { allowsEmail, emailCategory } from './email-preferences.js';
import { renderEmail } from './email-templates.js';
import { operationalMetrics } from './operational-metrics.js';

export class EmailWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private static readonly claimLeaseMs = 5 * 60_000;
  constructor(private db: Database, private config: AppConfig) {}

  start(): void {
    if (!this.config.SMTP_HOST) { logger.warn('SMTP is not configured; email outbox will remain queued'); return; }
    this.timer = setInterval(() => void this.tick(), 10_000); this.timer.unref(); void this.tick();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
      operationalMetrics.record('email_worker', true);
    } catch {
      operationalMetrics.record('email_worker', false);
      logger.error('Email worker failed; it will retry on its next tick');
    } finally { this.running = false; }
  }

  async runOnce(): Promise<void> {
    if (!this.config.SMTP_HOST) return;
    const transport = nodemailer.createTransport({ host: this.config.SMTP_HOST, port: this.config.SMTP_PORT, secure: this.config.SMTP_SECURE, auth: this.config.SMTP_USER ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });
    const jobs = await this.claimJobs();
    for (const { job, recipient, displayName, preferences } of jobs) {
      try {
        const category = emailCategory(job.template);
        if (category && !allowsEmail(preferences, category)) {
          await this.db.update(emailOutbox).set({ suppressedAt: new Date(), suppressionReason: `preference:${category}` }).where(eq(emailOutbox.id, job.id));
          continue;
        }
        const directRecipient = job.recipientEmailCiphertext ? decryptText(job.recipientEmailCiphertext, this.config.DATA_ENCRYPTION_KEY) : null;
        const payload = job.encryptedPayload ? JSON.parse(decryptText(job.encryptedPayload, this.config.DATA_ENCRYPTION_KEY)) as Record<string, unknown> : job.payload as Record<string, unknown>;
        const to = directRecipient ?? recipient;
        if (!to) throw new Error('Email job has no recipient');
        const rendered = renderEmail({ template: job.template, payload, displayName, config: this.config });
        await transport.sendMail({ from: `"${this.config.SMTP_FROM_NAME}" <${this.config.SMTP_FROM_EMAIL}>`, to, ...rendered });
        await this.db.update(emailOutbox).set({ sentAt: new Date() }).where(eq(emailOutbox.id, job.id));
        operationalMetrics.record('email_delivery', true);
      } catch (error) {
        operationalMetrics.record('email_delivery', false);
        await this.db.update(emailOutbox).set({ lastError: error instanceof Error ? error.message.slice(0, 500) : 'SMTP error', ...(job.attempts >= 5 ? { failedAt: new Date() } : { availableAt: new Date(Date.now() + 2 ** job.attempts * 60_000) }) }).where(eq(emailOutbox.id, job.id));
        logger.error({ jobId: job.id, err: error }, 'email outbox delivery failed');
      }
    }
  }

  private claimJobs() {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const availableAt = new Date(now.getTime() + EmailWorker.claimLeaseMs);
      const jobs = await tx.select({
        job: emailOutbox,
        recipient: users.email,
        displayName: users.displayName,
        preferences: {
          enabled: emailPreferences.enabled,
          listingUpdates: emailPreferences.listingUpdates,
          transactionUpdates: emailPreferences.transactionUpdates,
          messageUpdates: emailPreferences.messageUpdates,
          policyReminders: emailPreferences.policyReminders,
        },
      }).from(emailOutbox)
        .leftJoin(users, eq(users.id, emailOutbox.recipientUserId))
        .leftJoin(emailPreferences, eq(emailPreferences.userId, emailOutbox.recipientUserId))
        .where(and(isNull(emailOutbox.sentAt), isNull(emailOutbox.failedAt), isNull(emailOutbox.suppressedAt), lte(emailOutbox.availableAt, now), ne(emailOutbox.template, 'student-email-otp')))
        .orderBy(asc(emailOutbox.createdAt)).limit(10).for('update', { of: emailOutbox, skipLocked: true });
      for (const { job } of jobs) {
        await tx.update(emailOutbox).set({ availableAt, attempts: job.attempts + 1 }).where(eq(emailOutbox.id, job.id));
      }
      return jobs.map(({ job, ...recipient }) => ({ ...recipient, job: { ...job, availableAt, attempts: job.attempts + 1 } }));
    });
  }
}
