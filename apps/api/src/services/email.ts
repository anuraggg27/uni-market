import { and, asc, eq, isNull, lte, ne } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { decryptText } from '../lib/crypto.js';

export class EmailWorker {
  private timer?: NodeJS.Timeout;
  private static readonly claimLeaseMs = 5 * 60_000;
  constructor(private db: Database, private config: AppConfig) {}

  start(): void {
    if (!this.config.SMTP_HOST) { logger.warn('SMTP is not configured; email outbox will remain queued'); return; }
    this.timer = setInterval(() => void this.runOnce(), 10_000); this.timer.unref(); void this.runOnce();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  async runOnce(): Promise<void> {
    if (!this.config.SMTP_HOST) return;
    const transport = nodemailer.createTransport({ host: this.config.SMTP_HOST, port: this.config.SMTP_PORT, secure: this.config.SMTP_SECURE, auth: this.config.SMTP_USER ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } : undefined });
    const jobs = await this.claimJobs();
    for (const { job, recipient, displayName } of jobs) {
      try {
        const directRecipient = job.recipientEmailCiphertext ? decryptText(job.recipientEmailCiphertext, this.config.DATA_ENCRYPTION_KEY) : null;
        const payload = job.encryptedPayload ? JSON.parse(decryptText(job.encryptedPayload, this.config.DATA_ENCRYPTION_KEY)) as Record<string, unknown> : job.payload as Record<string, unknown>;
        const to = directRecipient ?? recipient;
        if (!to) throw new Error('Email job has no recipient');
        await transport.sendMail({ from: `"${this.config.SMTP_FROM_NAME}" <${this.config.SMTP_FROM_EMAIL}>`, to, subject: subject(job.template), text: `${displayName ?? 'Hello'},\n\n${body(job.template, payload)}\n\nOpen Uni Market to view the details.\n\nStay safe: inspect the product before paying and never share an OTP.` });
        await this.db.update(emailOutbox).set({ sentAt: new Date() }).where(eq(emailOutbox.id, job.id));
      } catch (error) {
        await this.db.update(emailOutbox).set({ lastError: error instanceof Error ? error.message.slice(0, 500) : 'SMTP error', ...(job.attempts >= 5 ? { failedAt: new Date() } : { availableAt: new Date(Date.now() + 2 ** job.attempts * 60_000) }) }).where(eq(emailOutbox.id, job.id));
        logger.error({ jobId: job.id, err: error }, 'email outbox delivery failed');
      }
    }
  }

  private claimJobs() {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const availableAt = new Date(now.getTime() + EmailWorker.claimLeaseMs);
      const jobs = await tx.select({ job: emailOutbox, recipient: users.email, displayName: users.displayName }).from(emailOutbox).leftJoin(users, eq(users.id, emailOutbox.recipientUserId)).where(and(isNull(emailOutbox.sentAt), isNull(emailOutbox.failedAt), lte(emailOutbox.availableAt, now), ne(emailOutbox.template, 'student-email-otp'))).orderBy(asc(emailOutbox.createdAt)).limit(10).for('update', { of: emailOutbox, skipLocked: true });
      for (const { job } of jobs) {
        await tx.update(emailOutbox).set({ availableAt, attempts: job.attempts + 1 }).where(eq(emailOutbox.id, job.id));
      }
      return jobs.map(({ job, ...recipient }) => ({ ...recipient, job: { ...job, availableAt, attempts: job.attempts + 1 } }));
    });
  }
}

function subject(template: string): string {
  const subjects: Record<string, string> = { 'first-conversation-message': 'A buyer messaged you', listing_approved: 'Your listing was approved', listing_rejected: 'Your listing needs attention', listing_removed: 'Your listing was removed', 'support-response': 'Support replied to your request', 'grievance-received': 'Your Uni Market grievance receipt', 'grievance-response': 'Update on your Uni Market grievance', 'grievance-new-internal': 'New grievance requires review', 'grievance-follow-up-internal': 'New information on a grievance', 'grievance-appeal-internal': 'Grievance appeal requires review', 'grievance-deadline-internal': 'Grievance deadline alert', 'policy-reminder': 'Reminder: Uni Market rules and policies' };
  return subjects[template] ?? 'Important Uni Market update';
}
function body(template: string, payload: Record<string, unknown> = {}): string {
  const bodies: Record<string, string> = { 'first-conversation-message': 'A buyer started a conversation about your listing.', listing_approved: 'Your listing passed manual review and is now visible.', listing_rejected: 'Your listing did not pass review. Open the listing to read the reason and edit it.', listing_removed: 'A moderator removed your listing.', 'support-response': 'A support agent replied to your support request.' };
  if (template === 'grievance-received') return `We received your grievance. Reference: ${String(payload.reference ?? '')}. Tracking secret: ${String(payload.trackingSecret ?? '')}. Keep the secret private.`;
  if (template === 'grievance-response') return `There is an update on grievance ${String(payload.reference ?? '')}. Use your reference and tracking secret to view it.`;
  if (template === 'grievance-new-internal') return `A new grievance requires review. Reference: ${String(payload.reference ?? '')}. Category: ${String(payload.category ?? '')}. Action target: ${String(payload.actionDueAt ?? '')}. Open the private queue: ${String(payload.adminUrl ?? '')}.`;
  if (template === 'grievance-follow-up-internal') return `A reporter added information to grievance ${String(payload.reference ?? '')}. Open the private queue: ${String(payload.adminUrl ?? '')}.`;
  if (template === 'grievance-appeal-internal') return `An appeal was submitted for grievance ${String(payload.reference ?? '')}. New action target: ${String(payload.actionDueAt ?? '')}. Open the private queue: ${String(payload.adminUrl ?? '')}.`;
  if (template === 'grievance-deadline-internal') return `Grievance ${String(payload.reference ?? '')} is ${String(payload.stage ?? '')}. Category: ${String(payload.category ?? '')}. Action target: ${String(payload.actionDueAt ?? '')}. Open the private queue: ${String(payload.adminUrl ?? '')}.`;
  if (template === 'policy-reminder') return 'Please review the current Terms, Privacy Notice, Community Rules, and Seller Policy. Continued use is subject to these rules.';
  return bodies[template] ?? 'There is an important update on your account.';
}
