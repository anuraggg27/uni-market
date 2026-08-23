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
  ne,
  or,
  sql,
} from "drizzle-orm";
import { idSchema, reportReasons } from "@campus-market/shared";
import { z } from "zod";
import type { Database } from "../db/client.js";
import {
  adminAuditLogs,
  categories,
  conversations,
  emailOutbox,
  listings,
  messages,
  moderationNotes,
  notifications,
  phoneVerifications,
  prohibitedTerms,
  reports,
  reviews,
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
} from "../middleware/auth.js";
import { sha256 } from "../lib/crypto.js";
import { AppError, asyncRoute } from "../lib/errors.js";

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

export function userOperationsRouter(db: Database): Router {
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
        const report = (
          await db
            .insert(reports)
            .values({
              reporterId: req.auth!.userId,
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
        res.status(201).json({ data: report });
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
      res.status(204).end();
    }),
  );

  router.post(
    "/support",
    requireVerified,
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
    requireVerified,
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
  db: Database,
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

export function adminRouter(db: Database): Router {
  const router = Router();
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
        metric(listings, eq(listings.moderationState, "PENDING")),
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
    "/listings/pending",
    moderation,
    asyncRoute(async (req, res) => {
      const query = z
        .object({
          sort: z.enum(["oldest", "newest"]).default("oldest"),
          seller: z.string().uuid().optional(),
          category: z.string().uuid().optional(),
          flagged: z.enum(["true", "false"]).optional(),
        })
        .parse(req.query);
      const conditions = [eq(listings.moderationState, "PENDING"), isNull(listings.deletedAt)];
      if (query.seller) conditions.push(eq(listings.sellerId, query.seller));
      if (query.category)
        conditions.push(eq(listings.categoryId, query.category));
      if (query.flagged === "true")
        conditions.push(
          sql`exists (select 1 from ${prohibitedTerms} pt where pt.active = true and (${listings.title} ilike ('%' || pt.term || '%') or ${listings.description} ilike ('%' || pt.term || '%') or coalesce(${listings.defects}, '') ilike ('%' || pt.term || '%')))`,
        );
      const rows = await db
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
        );
      const activeTerms = await db
        .select({ term: prohibitedTerms.term })
        .from(prohibitedTerms)
        .where(eq(prohibitedTerms.active, true));
      res.json({
        data: rows.map((row) => ({
          ...row,
          flaggedTerms: activeTerms
            .filter(({ term }) =>
              `${row.listing.title} ${row.listing.description} ${row.listing.defects ?? ""}`
                .toLocaleLowerCase()
                .includes(term.toLocaleLowerCase()),
            )
            .map(({ term }) => term),
        })),
      });
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
      const current = (await db.select().from(listings).where(and(eq(listings.id, id), isNull(listings.deletedAt))).limit(1))[0];
      if (!current) throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found");
      const deletedAt = new Date();
      await db.update(listings).set({ deletedAt, updatedAt: deletedAt }).where(eq(listings.id, id));
      await audit(db, req, {
        action: "LISTING_DELETE",
        targetType: "LISTING",
        targetId: id,
        previousState: current,
        newState: { deletedAt },
        internalReason: "Listing deleted by administrator",
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
      const current = (
        await db.select().from(listings).where(eq(listings.id, id)).limit(1)
      )[0];
      if (!current)
        throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found");
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
                  rejectionReason: input.userVisibleReason!,
                  approvedAt: null,
                };
      const updated = await db.transaction(async (tx) => {
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
        await tx.insert(emailOutbox).values({
          recipientUserId: current.sellerId,
          template: type.toLowerCase(),
          payload: { listingId: id, reason: input.userVisibleReason },
          dedupeKey: `${type}:${id}:${Date.now()}`,
        });
        return row;
      });
      await audit(db, req, {
        action: `LISTING_${input.decision}`,
        targetType: "LISTING",
        targetId: id,
        previousState: {
          moderationState: current.moderationState,
          lifecycleState: current.lifecycleState,
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
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db
          .select()
          .from(reports)
          .where(inArray(reports.status, ["OPEN", "INVESTIGATING"]))
          .orderBy(asc(reports.createdAt)),
      }),
    ),
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
      res.json({ data: { ...report, context } });
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
      res.json({
        data: await db
          .select({
            id: users.id,
            displayName: users.displayName,
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
          .limit(100),
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
      });
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
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db
          .select()
          .from(reviews)
          .orderBy(desc(reviews.createdAt))
          .limit(100),
      }),
    ),
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
      const condition = req.auth!.roles.includes("SUPER_ADMIN")
        ? undefined
        : or(
            eq(supportTickets.assignedTo, req.auth!.userId),
            isNull(supportTickets.assignedTo),
          );
      res.json({
        data: await db
          .select()
          .from(supportTickets)
          .where(condition)
          .orderBy(asc(supportTickets.createdAt)),
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
          await tx.insert(emailOutbox).values({
            recipientUserId: ticket.userId,
            template: "support-response",
            payload: { ticketId: id },
            dedupeKey: `support-response:${message.id}`,
          });
        }
        return message;
      });
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
      const report = (
        await db
          .insert(reports)
          .values({
            reporterId: req.auth!.userId,
            targetType: "SUPPORT_TICKET",
            targetId: id,
            reason: "OTHER",
            details: reason,
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
          .orderBy(asc(categories.sortOrder)),
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
      const category = (
        await db.insert(categories).values(input).returning()
      )[0]!;
      await audit(db, req, {
        action: "CATEGORY_CREATE",
        targetType: "CATEGORY",
        targetId: category.id,
        newState: category,
        internalReason: "Category administration",
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
      const { term } = z
        .object({ term: z.string().trim().toLowerCase().min(2).max(120) })
        .parse(req.body);
      const created = (
        await db
          .insert(prohibitedTerms)
          .values({ term })
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
      const { active } = z.object({ active: z.boolean() }).parse(req.body);
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
          .set({ active })
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
