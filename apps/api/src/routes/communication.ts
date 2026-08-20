import { Router } from "express";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { idSchema, messageSchema } from "@campus-market/shared";
import type { Database } from "../db/client.js";
import {
  blocks,
  conversations,
  emailOutbox,
  favourites,
  listingImages,
  listings,
  messages,
  notifications,
  users,
} from "../db/schema.js";
import { requireAuth, requireVerified } from "../middleware/auth.js";
import { AppError, asyncRoute } from "../lib/errors.js";
import type { StorageService } from "../services/storage.js";

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
  onMessage?: (conversationId: string, message: unknown) => void,
): Router {
  const router = Router();

  router.get(
    "/favourites",
    requireAuth,
    asyncRoute(async (req, res) => {
      const rows = await db
        .select({
          listing: listings,
          imageKey: listingImages.objectKey,
          savedAt: favourites.createdAt,
        })
        .from(favourites)
        .innerJoin(listings, eq(listings.id, favourites.listingId))
        .leftJoin(
          listingImages,
          and(
            eq(listingImages.listingId, listings.id),
            eq(listingImages.position, 0),
            isNull(listingImages.deletedAt),
          ),
        )
        .where(eq(favourites.userId, req.auth!.userId))
        .orderBy(desc(favourites.createdAt));
      res.json({
        data: await Promise.all(
          rows.map(async ({ listing, imageKey, savedAt }) => ({
            ...listing,
            savedAt,
            coverImageUrl: imageKey
              ? await storage.signedReadUrl(imageKey)
              : null,
          })),
        ),
      });
    }),
  );

  router.post(
    "/favourites/:listingId",
    requireAuth,
    asyncRoute(async (req, res) => {
      const listingId = idSchema.parse(req.params.listingId);
      const listing = (
        await db
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
      )[0];
      if (!listing)
        throw new AppError(
          404,
          "LISTING_UNAVAILABLE",
          "This listing is unavailable",
        );
      const inserted = await db
        .insert(favourites)
        .values({ userId: req.auth!.userId, listingId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length)
        await db
          .update(listings)
          .set({ favouriteCount: sql`${listings.favouriteCount} + 1` })
          .where(eq(listings.id, listingId));
      res.status(inserted.length ? 201 : 200).json({ data: { saved: true } });
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
          imageKey: listingImages.objectKey,
          unread: sql<number>`(select count(*) from messages m where m.conversation_id = ${conversations.id} and m.sender_id <> ${req.auth!.userId} and m.read_at is null)`,
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
        .leftJoin(
          listingImages,
          and(
            eq(listingImages.listingId, listings.id),
            eq(listingImages.position, 0),
            isNull(listingImages.deletedAt),
          ),
        )
        .where(
          or(
            eq(conversations.buyerId, req.auth!.userId),
            eq(conversations.sellerId, req.auth!.userId),
          ),
        )
        .orderBy(desc(conversations.lastMessageAt));
      res.json({
        data: await Promise.all(
          rows.map(async (row) => ({
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
            unread: Number(row.unread),
            coverImageUrl: row.imageKey
              ? await storage.signedReadUrl(row.imageKey)
              : null,
          })),
        ),
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
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messages.conversationId, id),
            ne(messages.senderId, req.auth!.userId),
            isNull(messages.readAt),
          ),
        );
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
          await tx
            .insert(emailOutbox)
            .values({
              recipientUserId: otherId,
              template: "first-conversation-message",
              payload: { conversationId: id },
              dedupeKey: `first-conversation-message:${id}`,
            })
            .onConflictDoNothing();
        }
        return message;
      });
      onMessage?.(id, created);
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
