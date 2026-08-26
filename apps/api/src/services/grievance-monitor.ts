import { inArray } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox, reports } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { marketplaceUrl } from '../lib/marketplace-url.js';
import { directEmailJob } from './email-outbox.js';

export class GrievanceMonitor {
  private timer?: NodeJS.Timeout;

  constructor(private db: Database, private config: AppConfig) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), 5 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.runOnce(), 15_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    const now = new Date();
    const upcomingCutoff = new Date(now.getTime() + 60 * 60_000);
    const cases = await this.db.select({ id: reports.id, publicReference: reports.publicReference, category: reports.category, actionDueAt: reports.actionDueAt }).from(reports).where(inArray(reports.status, ['OPEN', 'INVESTIGATING']));
    const alerts = cases.filter((item) => item.actionDueAt <= upcomingCutoff).map((item) => {
      const stage = item.actionDueAt <= now ? 'OVERDUE' : 'DUE_SOON';
      return directEmailJob(this.config, {
        recipientEmail: this.config.GRIEVANCE_EMAIL,
        template: 'grievance-deadline-internal',
        payload: { reference: item.publicReference, category: item.category, stage, actionDueAt: item.actionDueAt.toISOString(), adminUrl: marketplaceUrl(this.config.CLIENT_URL, '/admin/grievances') },
        dedupeKey: `grievance-deadline:${item.id}:${stage}`,
      });
    });
    if (alerts.length) {
      const inserted = await this.db.insert(emailOutbox).values(alerts).onConflictDoNothing().returning({ id: emailOutbox.id });
      if (inserted.length) logger.warn({ grievanceAlerts: inserted.length }, 'grievance deadline alerts queued');
    }
  }
}
