import { Router, type Request } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { idSchema, reportReasons } from "@campus-market/shared";
import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import {
  adminAuditLogs,
  analyticsDailyPageVisitors,
  analyticsDailyReferrers,
  analyticsDailyVisitors,
  categories,
  conversations,
  emailOutbox,
  favourites,
  listings,
  listingImages,
  messages,
  moderationNotes,
  notifications,
  phoneVerifications,
  prohibitedTerms,
  reports,
  reportEvents,
  reviews,
  sessions,
  supportMessages,
  supportTickets,
  transactions,
  userRoles,
  users,
} from "../db/schema.js";
import {
  requireAuth,
  requireRole,
  requireVerified,
  requireStaffStepUp,
} from "../middleware/auth.js";
import { encryptText, sha256 } from "../lib/crypto.js";
import { grievanceClock, grievanceTracking } from "../lib/grievance.js";
import { AppError, asyncRoute } from "../lib/errors.js";
import { queueUserEmail } from "../services/email-preferences.js";
import { notifyNotifications } from "../services/notification-events.js";
import type { StorageService } from "../services/storage.js";

const reportSchema = z.object({
  targetType: z.enum([
    "LISTING",
    "USER",
    "REVIEW",
    "CONVERSATION",
    "SUPPORT_RESPONSE",
  ]),
  targetId: idSchema,
  reason: z.enum(reportReasons),
  details: z.string().trim().max(1500).optional(),
});
const ticketSchema = z.object({
  category: z.enum([
    "ACCOUNT",
    "LISTING",
    "TRANSACTION",
    "SAFETY",
    "TECHNICAL",
    "OTHER",
  ]),
  subject: z.string().trim().min(4).max(120),
  description: z.string().trim().min(20).max(5000),
  referenceType: z
    .enum(["LISTING", "TRANSACTION", "CONVERSATION"])
    .nullable()
    .optional(),
  referenceId: idSchema.nullable().optional(),
});

export function userOperationsRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.post(
    "/reports",
    requireVerified,
    asyncRoute(async (req, res) => {
      const input = reportSchema.parse(req.body);
      if (input.targetType === "CONVERSATION") {
        const conversation = (
          await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, input.targetId),
                or(
                  eq(conversations.buyerId, req.auth!.userId),
                  eq(conversations.sellerId, req.auth!.userId),
                ),
              ),
            )
            .limit(1)
        )[0];
        if (!conversation)
          throw new AppError(
            403,
            "REPORT_FORBIDDEN",
            "You cannot report this conversation",
          );
      }
      if (input.targetType === "LISTING") {
        const target = (
          await db
            .select({ id: listings.id })
            .from(listings)
            .where(
              and(
                eq(listings.id, input.targetId),
                eq(listings.moderationState, "APPROVED"),
                isNull(listings.deletedAt),
              ),
            )
            .limit(1)
        )[0];
        if (!target)
          throw new AppError(
            404,
            "REPORT_TARGET_UNAVAILABLE",
            "The item is unavailable",
          );
      }
      if (input.targetType === "USER") {
        if (input.targetId === req.auth!.userId)
          throw new AppError(400, "SELF_REPORT", "You cannot report yourself");
        const target = (
          await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.targetId), isNull(users.deletedAt)))
            .limit(1)
        )[0];
        if (!target)
          throw new AppError(
            404,
            "REPORT_TARGET_UNAVAILABLE",
            "The item is unavailable",
          );
      }
      if (input.targetType === "REVIEW") {
        const target = (
          await db
            .select({ id: reviews.id })
            .from(reviews)
            .where(
              and(
                eq(reviews.id, input.targetId),
                isNull(reviews.hiddenAt),
                isNull(reviews.deletedAt),
              ),
            )
            .limit(1)
        )[0];
        if (!target)
          throw new AppError(
            404,
            "REPORT_TARGET_UNAVAILABLE",
            "The item is unavailable",
          );
      }
      if (input.targetType === "SUPPORT_RESPONSE") {
        const target = (
          await db
            .select({ id: supportMessages.id })
            .from(supportMessages)
            .innerJoin(
              supportTickets,
              eq(supportTickets.id, supportMessages.ticketId),
            )
            .where(
              and(
                eq(supportMessages.id, input.targetId),
                eq(supportTickets.userId, req.auth!.userId),
                eq(supportMessages.internal, false),
                ne(supportMessages.senderId, req.auth!.userId),
              ),
            )
            .limit(1)
        )[0];
        if (!target)
          throw new AppError(
            403,
            "REPORT_FORBIDDEN",
            "You cannot report this response",
          );
      }
      try {
        const tracking = grievanceTracking(config.SESSION_SECRET);
        const clock = grievanceClock(input.reason);
        const reporter = (await db.select({ email: users.email }).from(users).where(eq(users.id, req.auth!.userId)).limit(1))[0]!;
        const report = (
          await db
            .insert(reports)
            .values({
              reporterId: req.auth!.userId,
              reporterEmailCiphertext: encryptText(reporter.email, config.DATA_ENCRYPTION_KEY),
              publicReference: tracking.publicReference,
              trackingHash: tracking.trackingHash,
              category: clock.category,
              priority: clock.priority,
              acknowledgeDueAt: clock.acknowledgeDueAt,
              actionDueAt: clock.actionDueAt,
              targetType: input.targetType,
              targetId: input.targetId,
              reason: input.reason,
              details: input.details ?? null,
              ...(input.targetType === "CONVERSATION"
                ? {
                    conversationContextStart: new Date(
                      Date.now() - 24 * 60 * 60_000,
                    ),
                    conversationContextEnd: new Date(),
                  }
                : {}),
            })
            .returning()
        )[0]!;
        res.status(201).json({ data: { ...report, reporterEmailCiphertext: undefined, trackingHash: undefined, trackingSecret: tracking.trackingSecret } });
      } catch (error: any) {
        if (
          error?.code === "23505" ||
          String(error?.message).includes("reports_dedupe_idx") ||
          String(error?.cause?.message).includes("reports_dedupe_idx")
        )
          throw new AppError(
            429,
            "DUPLICATE_REPORT",
            "This item is already under review from your report",
          );
        throw error;
      }
    }),
  );

  router.get(
    "/notifications",
    requireAuth,
    asyncRoute(async (req, res) => {
      const query = z
        .object({
          before: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        })
        .parse(req.query);
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, req.auth!.userId),
            ...(query.before
              ? [sql`${notifications.createdAt} < ${query.before}`]
              : []),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(query.limit);
      res.json({ data: rows, meta: { hasMore: rows.length === query.limit } });
    }),
  );
  router.patch(
    "/notifications/:id/read",
    requireAuth,
    asyncRoute(async (req, res) => {
      const updated = (
        await db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.id, idSchema.parse(req.params.id)),
              eq(notifications.userId, req.auth!.userId),
            ),
          )
          .returning()
      )[0];
      if (!updated)
        throw new AppError(
          404,
          "NOTIFICATION_NOT_FOUND",
          "Notification not found",
        );
      notifyNotifications(req.app.get('io'), [req.auth!.userId]);
      res.json({ data: updated });
    }),
  );
  router.post(
    "/notifications/read-all",
    requireAuth,
    asyncRoute(async (req, res) => {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, req.auth!.userId),
            isNull(notifications.readAt),
          ),
        );
      notifyNotifications(req.app.get('io'), [req.auth!.userId]);
      res.status(204).end();
    }),
  );

  router.post(
    "/support",
    requireAuth,
    asyncRoute(async (req, res) => {
      const input = ticketSchema.parse(req.body);
      const ticket = (
        await db
          .insert(supportTickets)
          .values({
            userId: req.auth!.userId,
            category: input.category,
            subject: input.subject,
            description: input.description,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
          })
          .returning()
      )[0]!;
      res.status(201).json({ data: ticket });
    }),
  );
  router.get(
    "/support",
    requireAuth,
    asyncRoute(async (req, res) => {
      res.json({
        data: await db
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.userId, req.auth!.userId))
          .orderBy(desc(supportTickets.updatedAt)),
      });
    }),
  );
  router.get(
    "/support/:id",
    requireAuth,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              eq(supportTickets.userId, req.auth!.userId),
            ),
          )
          .limit(1)
      )[0];
      if (!ticket)
        throw new AppError(
          403,
          "TICKET_FORBIDDEN",
          "You cannot access this support ticket",
        );
      const thread = await db
        .select({
          id: supportMessages.id,
          body: supportMessages.body,
          createdAt: supportMessages.createdAt,
          senderId: supportMessages.senderId,
          senderName: users.displayName,
        })
        .from(supportMessages)
        .innerJoin(users, eq(users.id, supportMessages.senderId))
        .where(
          and(
            eq(supportMessages.ticketId, id),
            eq(supportMessages.internal, false),
          ),
        )
        .orderBy(asc(supportMessages.createdAt));
      res.json({ data: { ...ticket, messages: thread } });
    }),
  );
  router.post(
    "/support/:id/messages",
    requireAuth,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { body } = z
        .object({ body: z.string().trim().min(1).max(5000) })
        .parse(req.body);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              eq(supportTickets.userId, req.auth!.userId),
            ),
          )
          .limit(1)
      )[0];
      if (!ticket)
        throw new AppError(
          403,
          "TICKET_FORBIDDEN",
          "You cannot access this support ticket",
        );
      if (ticket.status === "CLOSED")
        throw new AppError(
          409,
          "TICKET_CLOSED",
          "This support ticket is closed",
        );
      const message = (
        await db
          .insert(supportMessages)
          .values({ ticketId: id, senderId: req.auth!.userId, body })
          .returning()
      )[0]!;
      await db
        .update(supportTickets)
        .set({ status: "OPEN", updatedAt: new Date() })
        .where(eq(supportTickets.id, id));
      res.status(201).json({ data: message });
    }),
  );
  router.post(
    "/support/:id/reopen",
    requireAuth,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              eq(supportTickets.userId, req.auth!.userId),
            ),
          )
          .limit(1)
      )[0];
      if (
        !ticket ||
        ticket.status !== "RESOLVED" ||
        !ticket.resolvedAt ||
        Date.now() - ticket.resolvedAt.getTime() > 14 * 24 * 60 * 60_000
      )
        throw new AppError(
          409,
          "TICKET_NOT_REOPENABLE",
          "This ticket cannot be reopened",
        );
      const updated = (
        await db
          .update(supportTickets)
          .set({ status: "OPEN", resolvedAt: null, updatedAt: new Date() })
          .where(eq(supportTickets.id, id))
          .returning()
      )[0]!;
      res.json({ data: updated });
    }),
  );
  return router;
}

function primaryAdminRole(
  roles: string[],
): "MODERATOR" | "SUPER_ADMIN" | "SUPPORT_AGENT" {
  if (roles.includes("SUPER_ADMIN")) return "SUPER_ADMIN";
  if (roles.includes("MODERATOR")) return "MODERATOR";
  return "SUPPORT_AGENT";
}

async function audit(
  db: Pick<Database, "insert">,
  req: Request,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    previousState?: unknown;
    newState?: unknown;
    internalReason: string;
    userVisibleReason?: string | undefined;
  },
) {
  await db.insert(adminAuditLogs).values({
    adminId: req.auth!.userId,
    role: primaryAdminRole(req.auth!.roles),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousState: input.previousState as any,
    newState: input.newState as any,
    internalReason: input.internalReason,
    userVisibleReason: input.userVisibleReason,
    requestId: req.requestId,
    ipHash: sha256(req.ip ?? "unknown"),
  });
}

export function adminRouter(
  db: Database,
  config: AppConfig,
  storage: StorageService,
): Router {
  const router = Router();
  router.use(requireStaffStepUp);
  const moderation = requireRole("MODERATOR", "SUPER_ADMIN");
  const support = requireRole("SUPPORT_AGENT", "SUPER_ADMIN");
  const admin = requireRole("SUPER_ADMIN");

  router.get(
    "/dashboard",
    requireRole("MODERATOR", "SUPPORT_AGENT", "SUPER_ADMIN"),
    asyncRoute(async (_req, res) => {
      const monthAgo = new Date();
      monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
      const metric = async (table: any, where?: any) =>
        Number(
          (await db.select({ value: count() }).from(table).where(where))[0]
            ?.value ?? 0,
        );
      const [
        totalUsers,
        newUsers,
        verifiedUsers,
        activeUsers,
        pendingListings,
        activeListings,
        rejectedListings,
        removedListings,
        completedTransactions,
        reservedListings,
        openReports,
        openTickets,
        rating,
        emailFailures,
        otpSuccess,
        otpFailure,
      ] = await Promise.all([
        metric(users, isNull(users.deletedAt)),
        metric(users, gte(users.createdAt, monthAgo)),
        metric(users, sql`${users.phoneVerifiedAt} is not null`),
        metric(users, gte(users.lastActiveAt, dayAgo)),
        metric(
          listings,
          and(
            eq(listings.moderationState, "PENDING"),
            isNotNull(listings.submittedAt),
            isNull(listings.deletedAt),
          ),
        ),
        metric(
          listings,
          and(
            eq(listings.moderationState, "APPROVED"),
            eq(listings.lifecycleState, "ACTIVE"),
          ),
        ),
        metric(listings, eq(listings.moderationState, "REJECTED")),
        metric(listings, eq(listings.moderationState, "REMOVED")),
        metric(transactions, eq(transactions.status, "COMPLETED")),
        metric(listings, eq(listings.lifecycleState, "RESERVED")),
        metric(reports, inArray(reports.status, ["OPEN", "INVESTIGATING"])),
        metric(
          supportTickets,
          inArray(supportTickets.status, [
            "OPEN",
            "ASSIGNED",
            "WAITING_FOR_USER",
          ]),
        ),
        db
          .select({ value: sql<number>`coalesce(avg(${reviews.rating}),0)` })
          .from(reviews)
          .where(and(isNull(reviews.hiddenAt), isNull(reviews.deletedAt))),
        metric(emailOutbox, sql`${emailOutbox.failedAt} is not null`),
        metric(
          phoneVerifications,
          sql`${phoneVerifications.usedAt} is not null`,
        ),
        metric(
          phoneVerifications,
          sql`${phoneVerifications.invalidatedAt} is not null and ${phoneVerifications.usedAt} is null`,
        ),
      ]);
      res.json({
        data: {
          totalUsers,
          newUsers,
          verifiedUsers,
          activeUsers,
          pendingListings,
          activeListings,
          rejectedListings,
          removedListings,
          completedTransactions,
          reservedListings,
          openReports,
          openTickets,
          averageRating: Number(rating[0]?.value ?? 0),
          emailFailures,
          otpSuccess,
          otpFailure,
          r2StorageUsage: null,
        },
      });
    }),
  );

  router.get(
    "/analytics",
    requireRole("MODERATOR", "SUPPORT_AGENT", "SUPER_ADMIN"),
    asyncRoute(async (req, res) => {
      const { range } = z.object({ range: z.enum(["7", "30", "90", "365", "all"]).default("90") }).parse(req.query);
      const today = new Date().toISOString().slice(0, 10);
      const days = range === "all" ? null : Number(range);
      const fromDay = days
        ? new Date(Date.now() - (days - 1) * 24 * 60 * 60_000).toISOString().slice(0, 10)
        : null;
      const visitorRange = fromDay ? gte(analyticsDailyVisitors.day, fromDay) : sql`true`;
      const pageRange = fromDay ? gte(analyticsDailyPageVisitors.day, fromDay) : sql`true`;
      const referrerRange = fromDay ? gte(analyticsDailyReferrers.day, fromDay) : sql`true`;
      const uniqueIdentity = sql`coalesce(${analyticsDailyVisitors.identityHash}, ${analyticsDailyVisitors.visitorHash})`;
      const [dailyRows, pageRows, referrerRows, deviceRows, firstRows, uniqueRows] = await Promise.all([
        db.select({
          date: analyticsDailyVisitors.day,
          visitors: count(),
        }).from(analyticsDailyVisitors).where(visitorRange).groupBy(analyticsDailyVisitors.day).orderBy(asc(analyticsDailyVisitors.day)),
        db.select({
          route: analyticsDailyPageVisitors.route,
          visitors: sql<number>`count(distinct ${analyticsDailyPageVisitors.identityHash})`,
        }).from(analyticsDailyPageVisitors).where(pageRange).groupBy(analyticsDailyPageVisitors.route).orderBy(desc(sql`count(distinct ${analyticsDailyPageVisitors.identityHash})`)).limit(8),
        db.select({
          source: analyticsDailyReferrers.source,
          visits: sql<number>`sum(${analyticsDailyReferrers.visits})`,
        }).from(analyticsDailyReferrers).where(referrerRange).groupBy(analyticsDailyReferrers.source).orderBy(desc(sql`sum(${analyticsDailyReferrers.visits})`)).limit(8),
        db.select({
          device: analyticsDailyVisitors.deviceType,
          visitors: sql<number>`count(distinct ${uniqueIdentity})`,
        }).from(analyticsDailyVisitors).where(visitorRange).groupBy(analyticsDailyVisitors.deviceType).orderBy(desc(sql`count(distinct ${uniqueIdentity})`)),
        db.select({ date: sql<string | null>`min(${analyticsDailyVisitors.day})` }).from(analyticsDailyVisitors),
        db.select({ visitors: sql<number>`count(distinct ${uniqueIdentity})` }).from(analyticsDailyVisitors).where(visitorRange),
      ]);
      const trackingStartedAt = firstRows[0]?.date ?? null;
      const seriesStart = trackingStartedAt && fromDay
        ? (trackingStartedAt > fromDay ? trackingStartedAt : fromDay)
        : trackingStartedAt;
      const rowsByDay = new Map(dailyRows.map((row) => [row.date, Number(row.visitors)]));
      const series: Array<{ date: string; visitors: number }> = [];
      if (seriesStart && trackingStartedAt) {
        for (let cursor = new Date(`${seriesStart}T00:00:00.000Z`); cursor <= new Date(`${today}T00:00:00.000Z`); cursor = new Date(cursor.getTime() + 24 * 60 * 60_000)) {
          const date = cursor.toISOString().slice(0, 10);
          series.push({ date, visitors: rowsByDay.get(date) ?? 0 });
        }
      }
      const visitorDays = series.reduce((sum, item) => sum + item.visitors, 0);
      const todayVisitors = rowsByDay.get(today) ?? 0;
      res.json({
        data: {
          range,
          from: seriesStart,
          to: today,
          trackingStartedAt,
          summary: {
            uniqueVisitors: Number(uniqueRows[0]?.visitors ?? 0),
            averageDailyVisitors: series.length ? Number((visitorDays / series.length).toFixed(1)) : 0,
            peakDailyVisitors: series.reduce((peak, item) => Math.max(peak, item.visitors), 0),
            todayVisitors,
          },
          series,
          topPages: pageRows.map((row) => ({ route: row.route, visitors: Number(row.visitors) })),
          referrers: referrerRows.map((row) => ({ source: row.source, visits: Number(row.visits) })),
          devices: deviceRows.map((row) => ({ device: row.device, visitors: Number(row.visitors) })),
        },
      });
    }),
  );

  router.get(
    ["/listings", "/listings/pending"],
    moderation,
    asyncRoute(async (req, res) => {
      const pendingOnly = req.path === "/listings/pending";
      const query = z
        .object({
          status: z.enum(["ALL", "PENDING", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "REMOVED", "DRAFT"]).default("ALL"),
          lifecycle: z.enum(["DRAFT", "ACTIVE", "RESERVED", "SOLD", "EXPIRED", "WITHDRAWN"]).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          sort: z.enum(["oldest", "newest"]).default(pendingOnly ? "oldest" : "newest"),
          seller: z.string().uuid().optional(),
          category: z.string().uuid().optional(),
          flagged: z.enum(["true", "false"]).optional(),
        })
        .parse(req.query);
      const conditions = [isNull(listings.deletedAt)];
      const status = pendingOnly ? "PENDING" : query.status;
      if (status === "PENDING") conditions.push(eq(listings.moderationState, "PENDING"), isNotNull(listings.submittedAt));
      else if (status === "DRAFT") conditions.push(eq(listings.moderationState, "PENDING"), isNull(listings.submittedAt));
      else if (status === "CHANGES_REQUESTED") conditions.push(eq(listings.moderationState, "REJECTED"), isNotNull(listings.requestedChanges));
      else if (status === "REJECTED") conditions.push(eq(listings.moderationState, "REJECTED"), isNull(listings.requestedChanges));
      else if (status !== "ALL") conditions.push(eq(listings.moderationState, status));
      if (query.lifecycle) conditions.push(eq(listings.lifecycleState, query.lifecycle));
      if (query.seller) conditions.push(eq(listings.sellerId, query.seller));
      if (query.category)
        conditions.push(eq(listings.categoryId, query.category));
      if (query.flagged === "true")
        conditions.push(
          sql`exists (select 1 from ${prohibitedTerms} pt where pt.active = true and (${listings.title} ilike ('%' || pt.term || '%') or ${listings.description} ilike ('%' || pt.term || '%') or coalesce(${listings.defects}, '') ilike ('%' || pt.term || '%')))`,
        );
      const pageSize = 50;
      const rowsQuery = db
        .select({
          listing: listings,
          sellerName: users.displayName,
          sellerCompletedSales: users.completedSales,
          categoryName: categories.name,
        })
        .from(listings)
        .innerJoin(users, eq(users.id, listings.sellerId))
        .innerJoin(categories, eq(categories.id, listings.categoryId))
        .where(and(...conditions))
        .orderBy(
          query.sort === "oldest"
            ? asc(listings.updatedAt)
            : desc(listings.updatedAt),
          asc(listings.id),
        );
      const [rows, totals] = await Promise.all([
        pendingOnly ? rowsQuery : rowsQuery.limit(pageSize).offset((query.page - 1) * pageSize),
        pendingOnly ? Promise.resolve([]) : db.select({ total: count() }).from(listings).where(and(...conditions)),
      ]);
      const activeTerms = await db
        .select({ term: prohibitedTerms.term })
        .from(prohibitedTerms)
        .where(eq(prohibitedTerms.active, true));
      const listingIds = rows.map(({ listing }) => listing.id);
      const coverImages = listingIds.length
        ? await db
            .select({
              listingId: listingImages.listingId,
              objectKey: listingImages.objectKey,
            })
            .from(listingImages)
            .where(
              and(
                inArray(listingImages.listingId, listingIds),
                isNull(listingImages.deletedAt),
                isNotNull(listingImages.finalizedAt),
                isNotNull(listingImages.objectKey),
              ),
            )
            .orderBy(asc(listingImages.position))
        : [];
      const coverImageKeys = new Map<string, string>();
      for (const image of coverImages) {
        if (image.objectKey && !coverImageKeys.has(image.listingId)) {
          coverImageKeys.set(image.listingId, image.objectKey);
        }
      }
      const data = await Promise.all(
        rows.map(async (row) => {
          const coverImageKey = coverImageKeys.get(row.listing.id);
          return {
            ...row,
            coverImageUrl: coverImageKey
              ? await storage.signedReadUrl(coverImageKey)
              : null,
            flaggedTerms: activeTerms
              .filter(({ term }) =>
                `${row.listing.title} ${row.listing.description} ${row.listing.defects ?? ""}`
                  .toLocaleLowerCase()
                  .includes(term.toLocaleLowerCase()),
              )
              .map(({ term }) => term),
          };
        }),
      );
      res.json({ data: pendingOnly ? data : { rows: data, total: totals[0]?.total ?? 0, page: query.page, pageSize } });
    }),
  );

  router.get(
    "/listings/:id",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const listing = (
        await db
          .select({
            listing: listings,
            seller: {
              id: users.id,
              displayName: users.displayName,
              institution: users.institution,
              campus: users.campus,
              phoneVerifiedAt: users.phoneVerifiedAt,
              suspendedAt: users.suspendedAt,
              completedSales: users.completedSales,
            },
          })
          .from(listings)
          .innerJoin(users, eq(users.id, listings.sellerId))
          .where(and(eq(listings.id, id), isNull(listings.deletedAt)))
          .limit(1)
      )[0];
      if (!listing)
        throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found");
      const history = await db
        .select({
          id: listings.id,
          title: listings.title,
          rejectionReason: listings.rejectionReason,
          updatedAt: listings.updatedAt,
        })
        .from(listings)
        .where(
          and(
            eq(listings.sellerId, listing.listing.sellerId),
            eq(listings.moderationState, "REJECTED"),
          ),
        )
        .orderBy(desc(listings.updatedAt))
        .limit(10);
      res.json({ data: { ...listing, rejectionHistory: history } });
    }),
  );

  router.delete(
    "/listings/:id",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      await db.transaction(async tx => {
        const current = (await tx.select().from(listings).where(and(eq(listings.id, id), isNull(listings.deletedAt))).limit(1).for("update"))[0];
        if (!current) throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found");
        const deletedAt = new Date();
        await tx.update(listings).set({ deletedAt, updatedAt: deletedAt, favouriteCount: 0 }).where(eq(listings.id, id));
        await tx.delete(favourites).where(eq(favourites.listingId, id));
        await audit(tx, req, {
          action: "LISTING_DELETE",
          targetType: "LISTING",
          targetId: id,
          previousState: current,
          newState: { deletedAt, favouriteCount: 0 },
          internalReason: "Listing deleted by administrator",
        });
      });
      res.status(204).send();
    }),
  );
  router.post(
    "/listings/:id/decision",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = z
        .object({
          decision: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES", "REMOVE"]),
          internalReason: z.string().trim().max(2000).default(""),
          userVisibleReason: z.string().trim().max(1000).optional(),
          note: z.string().trim().max(2000).optional(),
        })
        .parse(req.body);
      if (input.decision !== "APPROVE" && input.internalReason.length < 3)
        throw new AppError(
          400,
          "REASON_REQUIRED",
          "An internal reason is required",
        );
      if (input.decision !== "APPROVE" && !input.userVisibleReason)
        throw new AppError(
          400,
          "REASON_REQUIRED",
          "A user-visible reason is required",
        );
      const patch =
        input.decision === "APPROVE"
          ? {
              moderationState: "APPROVED" as const,
              lifecycleState: "ACTIVE" as const,
              approvedAt: new Date(),
              rejectionReason: null,
              requestedChanges: null,
            }
          : input.decision === "REJECT"
            ? {
                moderationState: "REJECTED" as const,
                lifecycleState: "DRAFT" as const,
                rejectionReason: input.userVisibleReason!,
                requestedChanges: null,
                approvedAt: null,
              }
            : input.decision === "REQUEST_CHANGES"
              ? {
                  moderationState: "REJECTED" as const,
                  lifecycleState: "DRAFT" as const,
                  requestedChanges: input.userVisibleReason!,
                  rejectionReason: input.userVisibleReason!,
                  approvedAt: null,
                }
              : {
                  moderationState: "REMOVED" as const,
                  requestedChanges: null,
                  rejectionReason: input.userVisibleReason!,
                  approvedAt: null,
                };
      const { updated, previous } = await db.transaction(async (tx) => {
        // Reservation acceptance locks this listing first. Read the current
        // lifecycle under the same lock before a moderation decision changes it.
        const current = (
          await tx
            .select()
            .from(listings)
            .where(eq(listings.id, id))
            .limit(1)
            .for("update")
        )[0];
        if (!current)
          throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found");
        if (
          ["RESERVED", "SOLD"].includes(current.lifecycleState) &&
          input.decision !== "REMOVE"
        ) {
          throw new AppError(
            409,
            "LISTING_LOCKED",
            "This moderation decision cannot change a reserved or sold listing",
          );
        }
        if (input.decision === "APPROVE") {
          if (!current.submittedAt)
            throw new AppError(
              409,
              "LISTING_NOT_SUBMITTED",
              "This listing has not been submitted for review",
            );
          const disallowedImages = await tx
            .select({ id: listingImages.id })
            .from(listingImages)
            .where(
              and(
                eq(listingImages.listingId, id),
                isNull(listingImages.deletedAt),
                ne(listingImages.syntheticStatus, "NOT_SYNTHETIC"),
              ),
            )
            .limit(1);
          if (disallowedImages.length)
            throw new AppError(
              400,
              "AI_GENERATED_IMAGE_NOT_ALLOWED",
              "AI-generated or materially altered listing images are not allowed",
            );
        }
        const row = (
          await tx
            .update(listings)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(listings.id, id))
            .returning()
        )[0]!;
        if (input.note)
          await tx.insert(moderationNotes).values({
            listingId: id,
            moderatorId: req.auth!.userId,
            note: input.note,
          });
        const type =
          input.decision === "APPROVE"
            ? "LISTING_APPROVED"
            : input.decision === "REMOVE"
              ? "LISTING_REMOVED"
              : "LISTING_REJECTED";
        await tx.insert(notifications).values({
          userId: current.sellerId,
          type,
          title:
            input.decision === "APPROVE"
              ? "Listing approved"
              : input.decision === "REMOVE"
                ? "Listing removed"
                : "Listing needs attention",
          body:
            input.decision === "APPROVE"
              ? "Your listing is now visible"
              : input.userVisibleReason!,
          href: `/listing/${id}`,
        });
        await queueUserEmail(tx, {
          recipientUserId: current.sellerId,
          template: type.toLowerCase(),
          payload: { listingId: id, listingTitle: current.title, reason: input.userVisibleReason },
          dedupeKey: `${type}:${id}:${Date.now()}`,
        });
        return { updated: row, previous: current };
      });
      notifyNotifications(req.app.get('io'), [previous.sellerId]);
      await audit(db, req, {
        action: `LISTING_${input.decision}`,
        targetType: "LISTING",
        targetId: id,
        previousState: {
          moderationState: previous.moderationState,
          lifecycleState: previous.lifecycleState,
        },
        newState: {
          moderationState: updated.moderationState,
          lifecycleState: updated.lifecycleState,
        },
        internalReason: input.internalReason || "Listing approved",
        userVisibleReason: input.userVisibleReason,
      });
      res.json({ data: updated });
    }),
  );

  router.get(
    "/reports",
    moderation,
    asyncRoute(async (_req, res) => {
      const rows = await db
          .select()
          .from(reports)
          .where(inArray(reports.status, ["OPEN", "INVESTIGATING"]))
          .orderBy(asc(reports.actionDueAt));
      res.json({ data: rows.map((row) => ({ ...row, trackingHash: undefined, reporterEmailCiphertext: undefined })) });
    }),
  );
  router.get(
    "/reports/:id",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const report = (
        await db.select().from(reports).where(eq(reports.id, id)).limit(1)
      )[0];
      if (!report)
        throw new AppError(404, "REPORT_NOT_FOUND", "Report not found");
      let context: unknown[] = [];
      if (
        report.targetType === "CONVERSATION" &&
        report.targetId &&
        report.conversationContextStart &&
        report.conversationContextEnd
      ) {
        context = await db
          .select({
            id: messages.id,
            senderId: messages.senderId,
            body: messages.body,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, report.targetId),
              gte(messages.createdAt, report.conversationContextStart),
              sql`${messages.createdAt} <= ${report.conversationContextEnd}`,
            ),
          )
          .orderBy(asc(messages.createdAt));
        await audit(db, req, {
          action: "VIEW_REPORTED_CONVERSATION_CONTEXT",
          targetType: "REPORT",
          targetId: id,
          internalReason: "Report investigation",
        });
      }
      res.json({ data: { ...report, trackingHash: undefined, reporterEmailCiphertext: undefined, context } });
    }),
  );
  router.post(
    "/reports/:id/resolve",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { outcome, reason } = z
        .object({
          outcome: z.enum(["RESOLVED", "DISMISSED"]),
          reason: z.string().trim().min(3).max(2000),
        })
        .parse(req.body);
      const updated = (
        await db
          .update(reports)
          .set({
            status: outcome,
            resolvedAt: new Date(),
            assignedTo: req.auth!.userId,
            updatedAt: new Date(),
          })
          .where(eq(reports.id, id))
          .returning()
      )[0];
      if (!updated)
        throw new AppError(404, "REPORT_NOT_FOUND", "Report not found");
      await audit(db, req, {
        action: `REPORT_${outcome}`,
        targetType: "REPORT",
        targetId: id,
        newState: { status: outcome },
        internalReason: reason,
      });
      await db.insert(reportEvents).values({ reportId: id, actorUserId: req.auth!.userId, eventType: outcome, publicMessage: reason });
      res.json({ data: updated });
    }),
  );

  router.post(
    "/users/:id/suspend",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(2000) })
        .parse(req.body);
      const targetRoles = await db
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, id));
      if (
        targetRoles.some((row) => row.role === "SUPER_ADMIN") &&
        !req.auth!.roles.includes("SUPER_ADMIN")
      )
        throw new AppError(
          403,
          "FORBIDDEN",
          "Only a super admin can suspend an administrator",
        );
      const previous = (
        await db.select().from(users).where(eq(users.id, id)).limit(1)
      )[0];
      if (!previous)
        throw new AppError(404, "USER_NOT_FOUND", "User not found");
      const updated = (
        await db
          .update(users)
          .set({ suspendedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning()
      )[0]!;
      await db.insert(notifications).values({
        userId: id,
        type: "MODERATION_WARNING",
        title: "Account suspended",
        body: "Your account has been suspended. Contact support for help.",
        href: "/support",
      });
      notifyNotifications(req.app.get('io'), [id]);
      await audit(db, req, {
        action: "USER_SUSPEND",
        targetType: "USER",
        targetId: id,
        previousState: { suspendedAt: previous.suspendedAt },
        newState: { suspendedAt: updated.suspendedAt },
        internalReason: reason,
      });
      res.json({ data: updated });
    }),
  );
  router.post(
    "/users/:id/warn",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(1000) })
        .parse(req.body);
      await db.insert(notifications).values({
        userId: id,
        type: "MODERATION_WARNING",
        title: "Marketplace warning",
        body: reason,
        href: "/support",
      });
      notifyNotifications(req.app.get('io'), [id]);
      await audit(db, req, {
        action: "USER_WARN",
        targetType: "USER",
        targetId: id,
        internalReason: reason,
        userVisibleReason: reason,
      });
      res.status(204).end();
    }),
  );

  router.get(
    "/users",
    moderation,
    asyncRoute(async (req, res) => {
      const q = z.string().max(100).optional().parse(req.query.q);
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          avatarId: users.avatarId,
          email: users.email,
          phoneVerifiedAt: users.phoneVerifiedAt,
          suspendedAt: users.suspendedAt,
          completedSales: users.completedSales,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          q
            ? or(
                ilike(users.displayName, `%${q}%`),
                ilike(users.email, `%${q}%`),
              )
            : undefined,
        )
        .orderBy(desc(users.createdAt))
        .limit(100);
      const roleRows = rows.length
        ? await db
            .select({ userId: userRoles.userId, role: userRoles.role })
            .from(userRoles)
            .where(inArray(userRoles.userId, rows.map((user) => user.id)))
        : [];
      const rolesByUser = new Map<string, string[]>();
      for (const role of roleRows) {
        const current = rolesByUser.get(role.userId) ?? [];
        current.push(role.role);
        rolesByUser.set(role.userId, current);
      }
      res.json({
        data: rows.map((user) => ({
          ...user,
          roles: rolesByUser.get(user.id) ?? [],
        })),
      });
    }),
  );
  router.get(
    "/users/:id",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const user = (
        await db.select().from(users).where(eq(users.id, id)).limit(1)
      )[0];
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      const roles = await db
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, id));
      res.json({
        data: {
          ...user,
          phoneE164: user.phoneE164
            ? `${user.phoneE164.slice(0, 3)}******${user.phoneE164.slice(-3)}`
            : null,
          roles,
        },
      });
    }),
  );
  router.put(
    "/users/:id/roles",
    admin,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const requested = z
        .object({
          roles: z
            .array(
              z.enum(["USER", "SUPPORT_AGENT", "MODERATOR", "SUPER_ADMIN"]),
            )
            .max(4),
          reason: z.string().trim().min(3).max(1000),
        })
        .parse(req.body);
      const roles = [...new Set(["USER" as const, ...requested.roles])];
      if (id === req.auth!.userId && !roles.includes("SUPER_ADMIN"))
        throw new AppError(
          409,
          "SELF_DEMOTION_BLOCKED",
          "You cannot remove your own super administrator access",
        );
      const target = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
      )[0];
      if (!target) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      const previous = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, id));
      await db.transaction(async (tx) => {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        await tx
          .insert(userRoles)
          .values(roles.map((role) => ({ userId: id, role })));
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, id));
        await tx.insert(notifications).values({ userId: id, type: 'MODERATION_WARNING', title: 'Staff access changed', body: 'Your account permissions changed. Sign in again to continue.', href: '/login' });
      });
      notifyNotifications(req.app.get('io'), [id]);
      await audit(db, req, {
        action: "USER_ROLES_UPDATE",
        targetType: "USER",
        targetId: id,
        previousState: { roles: previous.map((row) => row.role) },
        newState: { roles },
        internalReason: requested.reason,
      });
      res.json({ data: { roles } });
    }),
  );
  router.get(
    "/reviews",
    moderation,
    asyncRoute(async (_req, res) => {
      const rows = await db
        .select({
          review: reviews,
          listingId: transactions.listingId,
          listingTitle: listings.title,
          buyerId: transactions.buyerId,
          sellerId: transactions.sellerId,
          reviewer: {
            id: users.id,
            displayName: users.displayName,
            avatarId: users.avatarId,
          },
        })
        .from(reviews)
        .innerJoin(transactions, eq(transactions.id, reviews.transactionId))
        .innerJoin(listings, eq(listings.id, transactions.listingId))
        .innerJoin(users, eq(users.id, reviews.reviewerId))
        .orderBy(desc(reviews.createdAt))
        .limit(100);
      const listingIds = [...new Set(rows.map((row) => row.listingId))];
      const imageRows = listingIds.length
        ? await db
            .select({
              listingId: listingImages.listingId,
              objectKey: listingImages.objectKey,
              position: listingImages.position,
            })
            .from(listingImages)
            .where(
              and(
                inArray(listingImages.listingId, listingIds),
                isNull(listingImages.deletedAt),
                isNotNull(listingImages.finalizedAt),
                isNotNull(listingImages.objectKey),
              ),
            )
            .orderBy(asc(listingImages.position))
        : [];
      const coverKeys = new Map<string, string>();
      for (const image of imageRows) {
        if (image.objectKey && !coverKeys.has(image.listingId)) {
          coverKeys.set(image.listingId, image.objectKey);
        }
      }
      const coverUrls = new Map(
        await Promise.all(
          [...coverKeys].map(async ([listingId, key]) =>
            [listingId, await storage.signedReadUrl(key)] as const,
          ),
        ),
      );
      res.json({
        data: rows.map(({ review, listingId, listingTitle, buyerId, sellerId, reviewer }) => ({
          ...review,
          direction:
            review.reviewerId === buyerId && review.revieweeId === sellerId
              ? 'BUYER_TO_SELLER'
              : review.reviewerId === sellerId && review.revieweeId === buyerId
                ? 'SELLER_TO_BUYER'
                : null,
          listing: {
            id: listingId,
            title: listingTitle,
            coverImageUrl: coverUrls.get(listingId) ?? null,
          },
          reviewer,
        })),
      });
    }),
  );
  router.post(
    "/reviews/:id/hide",
    moderation,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(1000) })
        .parse(req.body);
      const current = (
        await db.select().from(reviews).where(eq(reviews.id, id)).limit(1)
      )[0];
      if (!current)
        throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
      const updated = (
        await db
          .update(reviews)
          .set({ hiddenAt: new Date(), hiddenReason: reason })
          .where(eq(reviews.id, id))
          .returning()
      )[0]!;
      await audit(db, req, {
        action: "REVIEW_HIDE",
        targetType: "REVIEW",
        targetId: id,
        previousState: { hiddenAt: null },
        newState: { hiddenAt: updated.hiddenAt },
        internalReason: reason,
      });
      res.json({ data: updated });
    }),
  );

  router.get(
    "/support",
    support,
    asyncRoute(async (req, res) => {
      const requester = alias(users, "support_requester");
      const assignee = alias(users, "support_assignee");
      const condition = req.auth!.roles.includes("SUPER_ADMIN")
        ? undefined
        : or(
            eq(supportTickets.assignedTo, req.auth!.userId),
            isNull(supportTickets.assignedTo),
          );
      res.json({
        data: (await db
          .select({
            ticket: supportTickets,
            requester: {
              id: requester.id,
              displayName: requester.displayName,
              avatarId: requester.avatarId,
            },
            assignee: {
              id: assignee.id,
              displayName: assignee.displayName,
              avatarId: assignee.avatarId,
            },
          })
          .from(supportTickets)
          .innerJoin(requester, eq(requester.id, supportTickets.userId))
          .leftJoin(assignee, eq(assignee.id, supportTickets.assignedTo))
          .where(condition)
          .orderBy(asc(supportTickets.createdAt)))
          .map(({ ticket, requester: requesterProfile, assignee: assigneeProfile }) => ({
            ...ticket,
            requester: requesterProfile,
            assignee: assigneeProfile,
          })),
      });
    }),
  );
  router.get(
    "/support/:id",
    support,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              ...(req.auth!.roles.includes("SUPER_ADMIN")
                ? []
                : [
                    or(
                      eq(supportTickets.assignedTo, req.auth!.userId),
                      isNull(supportTickets.assignedTo),
                    )!,
                  ]),
            ),
          )
          .limit(1)
      )[0];
      if (!ticket)
        throw new AppError(
          403,
          "TICKET_FORBIDDEN",
          "Ticket is not assigned to you",
        );
      const thread = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, id))
        .orderBy(asc(supportMessages.createdAt));
      res.json({ data: { ...ticket, messages: thread } });
    }),
  );
  router.post(
    "/support/:id/reply",
    support,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = z
        .object({
          body: z.string().trim().min(1).max(5000),
          internal: z.boolean().default(false),
          status: z
            .enum(["ASSIGNED", "WAITING_FOR_USER", "RESOLVED"])
            .default("WAITING_FOR_USER"),
        })
        .parse(req.body);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              ...(req.auth!.roles.includes("SUPER_ADMIN")
                ? []
                : [
                    or(
                      eq(supportTickets.assignedTo, req.auth!.userId),
                      isNull(supportTickets.assignedTo),
                    )!,
                  ]),
            ),
          )
          .limit(1)
      )[0];
      if (!ticket)
        throw new AppError(
          403,
          "TICKET_FORBIDDEN",
          "Ticket is not assigned to you",
        );
      const message = await db.transaction(async (tx) => {
        const message = (
          await tx
            .insert(supportMessages)
            .values({
              ticketId: id,
              senderId: req.auth!.userId,
              body: input.body,
              internal: input.internal,
            })
            .returning()
        )[0]!;
        await tx
          .update(supportTickets)
          .set({
            assignedTo: req.auth!.userId,
            status: input.status,
            ...(input.status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(supportTickets.id, id));
        if (!input.internal) {
          await tx.insert(notifications).values({
            userId: ticket.userId,
            type: "SUPPORT_RESPONSE",
            title: "Support replied",
            body: "There is a new reply on your support request",
            href: `/support/${id}`,
          });
          await queueUserEmail(tx, {
            recipientUserId: ticket.userId,
            template: "support-response",
            payload: { ticketId: id },
            dedupeKey: `support-response:${message.id}`,
          });
        }
        return message;
      });
      if (!input.internal) notifyNotifications(req.app.get('io'), [ticket.userId]);
      res.status(201).json({ data: message });
    }),
  );
  router.post(
    "/support/:id/escalate",
    support,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(1500) })
        .parse(req.body);
      const ticket = (
        await db
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, id),
              ...(req.auth!.roles.includes("SUPER_ADMIN")
                ? []
                : [eq(supportTickets.assignedTo, req.auth!.userId)]),
            ),
          )
          .limit(1)
      )[0];
      if (!ticket)
        throw new AppError(
          403,
          "TICKET_FORBIDDEN",
          "Ticket is not assigned to you",
        );
      const ticketOwner = (await db.select({ email: users.email }).from(users).where(eq(users.id, ticket.userId)).limit(1))[0]!;
      const tracking = grievanceTracking(config.SESSION_SECRET);
      const clock = grievanceClock('OTHER');
      const report = (
        await db
          .insert(reports)
          .values({
            reporterId: ticket.userId,
            reporterEmailCiphertext: encryptText(ticketOwner.email, config.DATA_ENCRYPTION_KEY),
            publicReference: tracking.publicReference,
            trackingHash: tracking.trackingHash,
            category: clock.category,
            priority: clock.priority,
            targetType: "SUPPORT_TICKET",
            targetId: id,
            reason: "OTHER",
            details: reason,
            acknowledgeDueAt: clock.acknowledgeDueAt,
            actionDueAt: clock.actionDueAt,
          })
          .returning()
      )[0]!;
      await db
        .update(supportTickets)
        .set({ escalatedReportId: report.id, updatedAt: new Date() })
        .where(eq(supportTickets.id, id));
      await audit(db, req, {
        action: "SUPPORT_ESCALATE",
        targetType: "SUPPORT_TICKET",
        targetId: id,
        newState: { reportId: report.id },
        internalReason: reason,
      });
      res.status(201).json({ data: report });
    }),
  );

  router.get(
    "/audit-logs",
    admin,
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db
          .select()
          .from(adminAuditLogs)
          .orderBy(desc(adminAuditLogs.createdAt))
          .limit(200),
      }),
    ),
  );
  router.get(
    "/categories",
    admin,
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db
          .select()
          .from(categories)
          .orderBy(asc(categories.sortOrder), asc(categories.name)),
      }),
    ),
  );
  router.post(
    "/categories",
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(80),
          slug: z.string().regex(/^[a-z0-9-]+$/),
          sortOrder: z.number().int().default(0),
        })
        .parse(req.body);
      const category = await db.transaction(async (tx) => {
        const [created] = await tx.insert(categories).values(input).onConflictDoNothing().returning();
        if (!created) {
          throw new AppError(409, "CATEGORY_EXISTS", "A category with this name or slug already exists. Use the existing category instead.");
        }
        await audit(tx, req, {
          action: "CATEGORY_CREATE",
          targetType: "CATEGORY",
          targetId: created.id,
          newState: created,
          internalReason: "Category administration",
        });
        return created;
      });
      res.status(201).json({ data: category });
    }),
  );
  router.patch(
    "/categories/:id",
    admin,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = z
        .object({
          name: z.string().trim().min(2).max(80).optional(),
          active: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
        })
        .strict()
        .parse(req.body);
      const previous = (
        await db.select().from(categories).where(eq(categories.id, id)).limit(1)
      )[0];
      if (!previous)
        throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
      const updated = (
        await db
          .update(categories)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .returning()
      )[0]!;
      await audit(db, req, {
        action: "CATEGORY_UPDATE",
        targetType: "CATEGORY",
        targetId: id,
        previousState: previous,
        newState: updated,
        internalReason: "Category administration",
      });
      res.json({ data: updated });
    }),
  );
  router.get(
    "/prohibited-terms",
    admin,
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db
          .select()
          .from(prohibitedTerms)
          .orderBy(asc(prohibitedTerms.term)),
      }),
    ),
  );
  router.post(
    "/prohibited-terms",
    admin,
    asyncRoute(async (req, res) => {
      const { term, severity } = z
        .object({ term: z.string().trim().toLowerCase().min(2).max(120), severity: z.enum(['FLAG', 'BLOCK']).default('FLAG') })
        .parse(req.body);
      const created = (
        await db
          .insert(prohibitedTerms)
          .values({ term, severity })
          .onConflictDoNothing()
          .returning()
      )[0];
      if (!created)
        throw new AppError(
          409,
          "TERM_EXISTS",
          "This prohibited term already exists",
        );
      await audit(db, req, {
        action: "PROHIBITED_TERM_CREATE",
        targetType: "PROHIBITED_TERM",
        targetId: created.id,
        newState: created,
        internalReason: "Moderation settings administration",
      });
      res.status(201).json({ data: created });
    }),
  );
  router.patch(
    "/prohibited-terms/:id",
    admin,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = z.object({ active: z.boolean().optional(), severity: z.enum(['FLAG', 'BLOCK']).optional() }).refine((value) => value.active !== undefined || value.severity !== undefined).parse(req.body);
      const previous = (
        await db
          .select()
          .from(prohibitedTerms)
          .where(eq(prohibitedTerms.id, id))
          .limit(1)
      )[0];
      if (!previous)
        throw new AppError(404, "TERM_NOT_FOUND", "Prohibited term not found");
      const updated = (
        await db
          .update(prohibitedTerms)
          .set(input)
          .where(eq(prohibitedTerms.id, id))
          .returning()
      )[0]!;
      await audit(db, req, {
        action: "PROHIBITED_TERM_UPDATE",
        targetType: "PROHIBITED_TERM",
        targetId: id,
        previousState: previous,
        newState: updated,
        internalReason: "Moderation settings administration",
      });
      res.json({ data: updated });
    }),
  );
  return router;
}
