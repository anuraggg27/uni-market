import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox, emailPreferences, legalHolds, listingImages, listings, messages, notifications, oauthAccounts, phoneVerifications, policyAcceptances, reportEvents, reports, retentionRuns, sessions, studentEmailVerifications, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { StorageService } from './storage.js';
import { randomUUID } from 'node:crypto';

type RetentionTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export const RETENTION_LOCK_ID = 873240126;

export class RetentionWorker {
  private timer: NodeJS.Timeout | undefined;
  private startupTimer: NodeJS.Timeout | undefined;
  private running = false;
  constructor(private db: Database, private config: AppConfig, private storage: StorageService) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), 24 * 60 * 60_000);
    this.timer.unref();
    this.startupTimer = setTimeout(() => void this.runOnce(), 60_000);
    this.startupTimer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = undefined;
    this.startupTimer = undefined;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const id = randomUUID();
    const startedAt = new Date();
    try {
      const counts = await this.db.transaction(async (tx) => {
        if (!this.config.DATABASE_URL.startsWith('pglite:')) {
          // Query-builder results have the same shape on postgres-js and PGlite.
          // Transaction locks stay on one connection, including behind a pooler,
          // and are released automatically on commit, rollback or disconnect.
          const [lock] = await tx.select({ locked: sql<boolean>`pg_try_advisory_xact_lock(${RETENTION_LOCK_ID})` }).from(sql`(select 1) as retention_lock`);
          if (!lock?.locked) return null;
          await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
          await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '120s'`);
        }
        await tx.insert(retentionRuns).values({ id, startedAt, mode: this.config.RETENTION_MODE, status: 'RUNNING', counts: {} });
        const result = await this.process(tx);
        await tx.update(retentionRuns).set({ status: 'COMPLETED', counts: result, completedAt: new Date() }).where(eq(retentionRuns.id, id));
        return result;
      });
      if (counts) logger.info({ retentionRunId: id, mode: this.config.RETENTION_MODE, counts }, 'retention run completed');
    } catch (error) {
      // The failed transaction (including its RUNNING audit) has rolled back.
      // Record failure separately; startup/lock errors must not reject a timer.
      await this.db.insert(retentionRuns).values({ id, startedAt, mode: this.config.RETENTION_MODE, status: 'FAILED', counts: {}, error: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown retention error', completedAt: new Date() }).catch((auditError) => {
        logger.error({ err: auditError, retentionRunId: id }, 'retention failure could not be recorded');
      });
      logger.error({ err: error, retentionRunId: id }, 'retention run failed');
    } finally {
      this.running = false;
    }
  }

  private async process(db: RetentionTransaction) {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
      const oneHundredEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60_000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60_000);
      const [purgeUsers, pendingImages, removedImages, activeHolds, policyReminderUsers, expiredGrievances] = await Promise.all([
        db.select().from(users).where(and(isNotNull(users.purgeAfter), lte(users.purgeAfter, now))),
        db.select().from(listingImages).where(and(isNull(listingImages.finalizedAt), isNull(listingImages.deletedAt), lte(listingImages.createdAt, oneHourAgo))),
        db.select({ image: listingImages, listing: listings }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(isNotNull(listingImages.objectKey), isNull(listingImages.deletedAt), or(and(isNotNull(listings.deletedAt), lte(listings.deletedAt, oneHundredEightyDaysAgo)), and(eq(listings.moderationState, 'REMOVED'), lte(listings.updatedAt, oneHundredEightyDaysAgo))))),
        db.select().from(legalHolds).where(isNull(legalHolds.releasedAt)),
        db.select({ id: users.id }).from(users).leftJoin(emailPreferences, eq(emailPreferences.userId, users.id)).where(and(eq(users.onboardingComplete, true), isNull(users.closedAt), isNull(users.deletedAt), or(isNull(users.policyReminderSentAt), lte(users.policyReminderSentAt, ninetyDaysAgo)), or(isNull(emailPreferences.userId), and(eq(emailPreferences.enabled, true), eq(emailPreferences.policyReminders, true))))),
        db.select({ id: reports.id }).from(reports).where(and(isNotNull(reports.purgeAfter), lte(reports.purgeAfter, now))),
      ]);
      const held = new Set(activeHolds.map((hold) => `${hold.targetType}:${hold.targetId}`));
      const eligibleUsers = purgeUsers.filter((user) => !held.has(`USER:${user.id}`));
      const eligibleRemovedImages = removedImages.filter(({ image, listing }) => !held.has(`LISTING:${listing.id}`) && !held.has(`USER:${image.ownerId}`));
      const eligibleGrievances = expiredGrievances.filter((report) => !held.has(`REPORT:${report.id}`));
      const counts = { users: eligibleUsers.length, pendingImages: pendingImages.length, removedImages: eligibleRemovedImages.length, grievances: eligibleGrievances.length, policyReminders: policyReminderUsers.length };
      if (this.config.RETENTION_MODE === 'enforce') {
        await Promise.all([...pendingImages, ...eligibleRemovedImages.map(({ image }) => image)].flatMap((image) => [image.tempKey, image.objectKey].filter((key): key is string => Boolean(key)).map((key) => this.storage.delete(key))));
        await db.transaction(async (tx) => {
          if (pendingImages.length) await tx.update(listingImages).set({ deletedAt: now, tempKey: null }).where(inArray(listingImages.id, pendingImages.map(({ id }) => id)));
          if (eligibleRemovedImages.length) await tx.update(listingImages).set({ deletedAt: now, objectKey: null }).where(inArray(listingImages.id, eligibleRemovedImages.map(({ image }) => image.id)));
          if (eligibleGrievances.length) {
            const reportIds = eligibleGrievances.map(({ id }) => id);
            await tx.delete(reportEvents).where(inArray(reportEvents.reportId, reportIds));
            await tx.update(reports).set({ reporterId: null, reporterEmailCiphertext: null, targetId: null, targetUrl: null, targetUrlCiphertext: null, details: null, detailsCiphertext: null, assignedTo: null, publicResponse: null, publicResponseCiphertext: null, purgeAfter: null, updatedAt: now }).where(inArray(reports.id, reportIds));
          }
          for (const user of eligibleUsers) {
            await tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, user.id));
            await tx.delete(sessions).where(eq(sessions.userId, user.id));
            await tx.delete(phoneVerifications).where(eq(phoneVerifications.userId, user.id));
            await tx.delete(studentEmailVerifications).where(eq(studentEmailVerifications.userId, user.id));
            await tx.delete(policyAcceptances).where(eq(policyAcceptances.userId, user.id));
            await tx.delete(notifications).where(eq(notifications.userId, user.id));
            await tx.update(users).set({ email: `deleted+${user.id}@invalid.local`, displayName: 'Deleted user', avatarId: 'avatar-01', institution: null, campus: null, graduationYear: null, phoneE164: null, phoneVerifiedAt: null, studentEmailCiphertext: null, studentEmailHash: null, studentEmailDomain: null, studentEmailVerifiedAt: null, studentEmailExpiresAt: null, adultAttestedAt: null, purgeAfter: null, updatedAt: now }).where(eq(users.id, user.id));
            await tx.update(listings).set({ title: 'Removed listing', description: 'Content removed after the retention period.', conditionExplanation: null, brand: null, defects: null, meetupPoint: null, moderationRiskCodes: [], updatedAt: now }).where(eq(listings.sellerId, user.id));
          }
          await tx.update(messages).set({ body: '[removed after retention period]', deletedAt: now }).where(and(lt(messages.createdAt, oneYearAgo), sql`exists (select 1 from ${users} u where u.id = ${messages.senderId} and u.closed_at is not null)`));
          await tx.delete(sessions).where(or(lt(sessions.expiresAt, oneYearAgo), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, oneYearAgo))));
          await tx.delete(phoneVerifications).where(lt(phoneVerifications.createdAt, oneYearAgo));
          await tx.delete(studentEmailVerifications).where(lt(studentEmailVerifications.createdAt, oneYearAgo));
          await tx.delete(emailOutbox).where(and(lt(emailOutbox.createdAt, oneYearAgo), or(isNotNull(emailOutbox.sentAt), isNotNull(emailOutbox.failedAt), isNotNull(emailOutbox.suppressedAt))));
          if (policyReminderUsers.length) {
            const quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
            await tx.insert(emailOutbox).values(policyReminderUsers.map(({ id }) => ({ recipientUserId: id, template: 'policy-reminder', payload: {}, dedupeKey: `policy-reminder:${id}:${quarter}` }))).onConflictDoNothing();
            await tx.update(users).set({ policyReminderSentAt: now }).where(inArray(users.id, policyReminderUsers.map(({ id }) => id)));
          }
        });
      }
      return counts;
  }
}
