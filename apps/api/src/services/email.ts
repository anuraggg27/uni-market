import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export class EmailWorker {
  private timer?: NodeJS.Timeout;
  constructor(private db: Database, private config: AppConfig) {}

  start(): void {
    if (!this.config.SMTP_HOST) { logger.warn('SMTP is not configured; email outbox will remain queued'); return; }
    this.timer = setInterval(() => void this.runOnce(), 10_000); this.timer.unref(); void this.runOnce();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  async runOnce(): Promise<void> {
    if (!this.config.SMTP_HOST) return;
    const transport = nodemailer.createTransport({ host: this.config.SMTP_HOST, port: this.config.SMTP_PORT, secure: this.config.SMTP_SECURE, auth: this.config.SMTP_USER ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } : undefined });
    const jobs = await this.db.select({ job: emailOutbox, recipient: users.email, displayName: users.displayName }).from(emailOutbox).innerJoin(users, eq(users.id, emailOutbox.recipientUserId)).where(and(isNull(emailOutbox.sentAt), isNull(emailOutbox.failedAt), lte(emailOutbox.availableAt, new Date()))).orderBy(asc(emailOutbox.createdAt)).limit(10);
    for (const { job, recipient, displayName } of jobs) {
      try {
        await transport.sendMail({ from: `"${this.config.SMTP_FROM_NAME}" <${this.config.SMTP_FROM_EMAIL}>`, to: recipient, subject: subject(job.template), text: `${displayName},\n\n${body(job.template)}\n\nOpen Uni Market to view the details.\n\nStay safe: inspect the product before paying and never share an OTP.` });
        await this.db.update(emailOutbox).set({ sentAt: new Date(), attempts: job.attempts + 1 }).where(eq(emailOutbox.id, job.id));
      } catch (error) {
        const attempts = job.attempts + 1;
        await this.db.update(emailOutbox).set({ attempts, lastError: error instanceof Error ? error.message.slice(0, 500) : 'SMTP error', ...(attempts >= 5 ? { failedAt: new Date() } : { availableAt: new Date(Date.now() + 2 ** attempts * 60_000) }) }).where(eq(emailOutbox.id, job.id));
        logger.error({ jobId: job.id, err: error }, 'email outbox delivery failed');
      }
    }
  }
}

function subject(template: string): string {
  const subjects: Record<string, string> = { 'first-conversation-message': 'A buyer messaged you', listing_approved: 'Your listing was approved', listing_rejected: 'Your listing needs attention', listing_removed: 'Your listing was removed', 'support-response': 'Support replied to your request' };
  return subjects[template] ?? 'Important Uni Market update';
}
function body(template: string): string {
  const bodies: Record<string, string> = { 'first-conversation-message': 'A buyer started a conversation about your listing.', listing_approved: 'Your listing passed manual review and is now visible.', listing_rejected: 'Your listing did not pass review. Open the listing to read the reason and edit it.', listing_removed: 'A moderator removed your listing.', 'support-response': 'A support agent replied to your support request.' };
  return bodies[template] ?? 'There is an important update on your account.';
}
