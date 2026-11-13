import { Router } from "express";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { idSchema, messageSchema } from "@campus-market/shared";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import {
  blocks,
  conversations,
  favourites,
  listings,
  messages,
  messageRiskEvents,
  notifications,
  users,
} from "../db/schema.js";
import { requireAuth, requireVerified } from "../middleware/auth.js";
import { AppError, asyncRoute } from "../lib/errors.js";
import type { StorageService } from "../services/storage.js";
import { createScamConfirmation, scamRiskCodes, verifyScamConfirmation } from "../services/scam-risk.js";
import { queueUserEmail } from "../services/email-preferences.js";
import { notifyChatUnread, notifyNotifications } from "../services/notification-events.js";
import { getReputation } from "../services/reputation.js";
import { getListingCoverUrls } from "../services/listing-images.js";

async function assertConversationMember(
  db: Database,
  conversationId: string,
  userId: string,
) {
  const conversation = (
    await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          or(
            eq(conversations.buyerId, userId),
            eq(conversations.sellerId, userId),
          ),
        ),
      )
      .limit(1)
  )[0];
  if (!conversation)
    throw new AppError(
      403,
      "CONVERSATION_FORBIDDEN",
      "You cannot access this conversation",
    );
  return conversation;
}

async function usersBlocked(
  db: Database,
  left: string,
  right: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, left), eq(blocks.blockedId, right)),
          and(eq(blocks.blockerId, right), eq(blocks.blockedId, left)),
        ),
      )
      .limit(1)
  )[0];
  return Boolean(row);
}

export function communicationRouter(
  db: Database,
  storage: StorageService,
  config: AppConfig,
  onMessage?: (conversationId: string, message: unknown) => void,
): Router {
  const router = Router();

  router.get('/conversations/unread-count', requireAuth, asyncRoute(async (req, res) => {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(conversations)
      .where(and(or(eq(conversations.buyerId, req.auth!.userId), eq(conversations.sellerId, req.auth!.userId)),
        sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id}
          and m.sender_id <> ${req.auth!.userId} and m.read_at is null and m.deleted_at is null)`));
    res.set('Cache-Control', 'no-store').json({ data: { count: Number(row?.count ?? 0) } });
  }));

  router.get('/conversations/:id/buyer-reputation', requireVerified, asyncRoute(async (req, res) => {
    const conversation = await assertConversationMember(db, idSchema.parse(req.params.id), req.auth!.userId);
    if (conversation.sellerId !== req.auth!.userId) {
      throw new AppError(403, 'BUYER_REPUTATION_FORBIDDEN', 'Buyer feedback is available to the seller in this conversation');
    }
    res.json({ data: await getReputation(db, conversation.buyerId, 'BUYER') });
  }));

  router.get(
    "/favourites",
    requireAuth,
    asyncRoute(async (req, res) => {
      const rows = await db
        .select({
          listing: listings,
          savedAt: favourites.createdAt,
        })
        .from(favourites)
        .innerJoin(listings, eq(listings.id, favourites.listingId))
        .where(and(
          eq(favourites.userId, req.auth!.userId),
          isNull(listings.deletedAt),
          eq(listings.moderationState, "APPROVED"),
          inArray(listings.lifecycleState, ["ACTIVE", "RESERVED", "SOLD"]),
        ))
        .orderBy(desc(favourites.createdAt));
      const covers = await getListingCoverUrls(db, storage, rows.map(({ listing }) => listing.id));
      res.json({
        data: rows.map(({ listing, savedAt }) => ({
          ...listing,
          savedAt,
          coverImageUrl: covers.get(listing.id) ?? null,
        })),
      });
    }),
  );

  router.post(
    "/favourites/:listingId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const listingId = idSchema.parse(req.params.listingId);
      const inserted = await db.transaction(async (tx) => {
        // Serialize saving with deletion so an in-flight save cannot recreate
        // a favourite after the listing's saved references have been cleared.
        const listing = (
          await tx
            .select({ id: listings.id })
            .from(listings)
            .where(
              and(
                eq(listings.id, listingId),
                eq(listings.moderationState, "APPROVED"),
                inArray(listings.lifecycleState, ["ACTIVE", "RESERVED", "SOLD"]),
                isNull(listings.deletedAt),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (!listing)
          throw new AppError(
            404,
            "LISTING_UNAVAILABLE",
            "This listing is unavailable",
          );
        const saved = await tx
          .insert(favourites)
          .values({ userId: req.auth!.userId, listingId })
          .onConflictDoNothing()
          .returning();
        if (saved.length)
          await tx
            .update(listings)
            .set({ favouriteCount: sql`${listings.favouriteCount} + 1` })
            .where(eq(listings.id, listingId));
        return saved.length;
      });
      res.status(inserted ? 201 : 200).json({ data: { saved: true } });
    }),
  );

  router.delete(
    "/favourites/:listingId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const listingId = idSchema.parse(req.params.listingId);
      const removed = await db
        .delete(favourites)
        .where(
          and(
            eq(favourites.userId, req.auth!.userId),
            eq(favourites.listingId, listingId),
          ),
        )
        .returning();
      if (removed.length)
        await db
          .update(listings)
          .set({
            favouriteCount: sql`greatest(${listings.favouriteCount} - 1, 0)`,
          })
          .where(eq(listings.id, listingId));
      res.status(204).end();
    }),
  );

  router.post(
    "/conversations",
    requireVerified,
    asyncRoute(async (req, res) => {
      const { listingId } = z.object({ listingId: idSchema }).parse(req.body);
      const listing = (
        await db
          .select()
          .from(listings)
          .where(
            and(
              eq(listings.id, listingId),
              eq(listings.moderationState, "APPROVED"),
              eq(listings.lifecycleState, "ACTIVE"),
              isNull(listings.deletedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!listing)
        throw new AppError(
          404,
          "LISTING_UNAVAILABLE",
          "This listing is unavailable",
        );
      if (listing.sellerId === req.auth!.userId)
        throw new AppError(
          400,
          "SELF_CONVERSATION",
          "You cannot contact yourself about your listing",
        );
      if (await usersBlocked(db, req.auth!.userId, listing.sellerId))
        throw new AppError(
          403,
          "USER_BLOCKED",
          "This conversation cannot be started",
        );
      const created = await db
        .insert(conversations)
        .values({
          listingId,
          buyerId: req.auth!.userId,
          sellerId: listing.sellerId,
        })
        .onConflictDoNothing()
        .returning();
      const conversation =
        created[0] ??
        (
          await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.listingId, listingId),
                eq(conversations.buyerId, req.auth!.userId),
                eq(conversations.sellerId, listing.sellerId),
              ),
            )
            .limit(1)
        )[0]!;
      res.status(created.length ? 201 : 200).json({ data: conversation });
    }),
  );

  router.get(
    "/conversations",
    requireAuth,
    asyncRoute(async (req, res) => {
      const rows = await db
        .select({
          conversation: conversations,
          listingTitle: listings.title,
          lifecycleState: listings.lifecycleState,
          buyerName: sql<string>`buyer.display_name`,
          sellerName: sql<string>`seller.display_name`,
          buyerAvatarId: sql<string>`buyer.avatar_id`,
          sellerAvatarId: sql<string>`seller.avatar_id`,
          unread: sql<number>`(select count(*) from messages m where m.conversation_id = ${conversations.id} and m.sender_id <> ${req.auth!.userId} and m.read_at is null and m.deleted_at is null)`,
        })
        .from(conversations)
        .innerJoin(listings, eq(listings.id, conversations.listingId))
        .innerJoin(
          sql`${users} as buyer`,
          sql`buyer.id = ${conversations.buyerId}`,
        )
        .innerJoin(
          sql`${users} as seller`,
          sql`seller.id = ${conversations.sellerId}`,
        )
        .where(
          or(
            eq(conversations.buyerId, req.auth!.userId),
            eq(conversations.sellerId, req.auth!.userId),
          ),
        )
        .orderBy(desc(conversations.lastMessageAt));
      const covers = await getListingCoverUrls(db, storage, rows.map(row => row.conversation.listingId));
      res.json({
        data: rows.map((row) => ({
          ...row.conversation,
          listingTitle: row.listingTitle,
          lifecycleState: row.lifecycleState,
          otherUserId:
            row.conversation.buyerId === req.auth!.userId
              ? row.conversation.sellerId
              : row.conversation.buyerId,
          otherName:
            row.conversation.buyerId === req.auth!.userId
              ? row.sellerName
              : row.buyerName,
          otherAvatarId:
            row.conversation.buyerId === req.auth!.userId
              ? row.sellerAvatarId
              : row.buyerAvatarId,
          unread: Number(row.unread),
          coverImageUrl: covers.get(row.conversation.listingId) ?? null,
        })),
      });
    }),
  );

  router.get(
    "/conversations/:id/messages",
    requireAuth,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      await assertConversationMember(db, id, req.auth!.userId);
      const query = z
        .object({
          before: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(40),
        })
        .parse(req.query);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, id),
            isNull(messages.deletedAt),
            ...(query.before ? [lt(messages.createdAt, query.before)] : []),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(query.limit);
      await db
        .update(messages)
        .set({ readAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(messages.conversationId, id),
            ne(messages.senderId, req.auth!.userId),
            isNull(messages.readAt),
          ),
        );
      notifyChatUnread(req.app.get('io'), req.auth!.userId);
      res.json({
        data: rows.reverse(),
        meta: { hasMore: rows.length === query.limit },
      });
    }),
  );

  router.post(
    "/conversations/:id/messages",
    requireVerified,
    asyncRoute(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = messageSchema.parse(req.body);
      const conversation = await assertConversationMember(
        db,
        id,
        req.auth!.userId,
      );
      const otherId =
        conversation.buyerId === req.auth!.userId
          ? conversation.sellerId
          : conversation.buyerId;
      if (await usersBlocked(db, req.auth!.userId, otherId))
        throw new AppError(
          403,
          "USER_BLOCKED",
          "Messages cannot be sent in this conversation",
        );
      const existing = (
        await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.senderId, req.auth!.userId),
              eq(messages.clientId, input.clientId),
            ),
          )
          .limit(1)
      )[0];
      if (existing) {
        res.json({ data: existing });
        return;
      }
      const riskCodes = scamRiskCodes(input.body);
      if (riskCodes.length && !verifyScamConfirmation(input.safetyConfirmationToken, req.auth!.userId, input.clientId, input.body, riskCodes, config.SESSION_SECRET)) {
        throw new AppError(409, 'SCAM_WARNING_REQUIRED', 'Review the safety warning before sending this message', { riskCodes, confirmationToken: createScamConfirmation(req.auth!.userId, input.clientId, input.body, riskCodes, config.SESSION_SECRET) });
      }
      const created = await db.transaction(async (tx) => {
        const message = (
          await tx
            .insert(messages)
            .values({
              conversationId: id,
              senderId: req.auth!.userId,
              clientId: input.clientId,
              body: input.body,
            })
            .returning()
        )[0]!;
        if (riskCodes.length) await tx.insert(messageRiskEvents).values({ messageId: message.id, userId: req.auth!.userId, riskCodes, acknowledgedAt: new Date() });
        await tx
          .update(conversations)
          .set({ lastMessageAt: message.createdAt })
          .where(eq(conversations.id, id));
        await tx
          .insert(notifications)
          .values({
            userId: otherId,
            type: "NEW_MESSAGE",
            title: "New message",
            body: "You have a new marketplace message",
            href: `/chats/${id}`,
          });
        if (!conversation.firstMessageEmailQueuedAt) {
          await tx
            .update(conversations)
            .set({ firstMessageEmailQueuedAt: new Date() })
            .where(
              and(
                eq(conversations.id, id),
                isNull(conversations.firstMessageEmailQueuedAt),
              ),
            );
          await queueUserEmail(tx, {
            recipientUserId: otherId,
            template: "first-conversation-message",
            payload: { conversationId: id },
            dedupeKey: `first-conversation-message:${id}`,
          });
        }
        return message;
      });
      onMessage?.(id, created);
      notifyNotifications(req.app.get('io'), [otherId]);
      res.status(201).json({ data: created });
    }),
  );

  router.post(
    "/blocks/:userId",
    requireVerified,
    asyncRoute(async (req, res) => {
      const blockedId = idSchema.parse(req.params.userId);
      if (blockedId === req.auth!.userId)
        throw new AppError(400, "SELF_BLOCK", "You cannot block yourself");
      await db
        .insert(blocks)
        .values({ blockerId: req.auth!.userId, blockedId })
        .onConflictDoNothing();
      res.status(201).json({ data: { blocked: true } });
    }),
  );

  router.delete(
    "/blocks/:userId",
    requireVerified,
    asyncRoute(async (req, res) => {
      await db
        .delete(blocks)
        .where(
          and(
            eq(blocks.blockerId, req.auth!.userId),
            eq(blocks.blockedId, idSchema.parse(req.params.userId)),
          ),
        );
      res.status(204).end();
    }),
  );

  return router;
}

export { assertConversationMember, usersBlocked };
