import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../apps/api/src/db/schema";
import { createDraft, login, setup, uploadImage, verifyPhone } from "./helper";

describe("illustrated avatar persistence", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    ctx = await setup();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("validates, persists, and exposes avatarId across a new login and seller profile", async () => {
    const firstSession = await login(ctx.app, "avatar-student");

    await firstSession.agent
      .patch("/api/auth/me/avatar")
      .set(firstSession.headers)
      .send({ avatarId: "avatar-06" })
      .expect(200);

    const invalid = await firstSession.agent
      .patch("/api/auth/me/avatar")
      .set(firstSession.headers)
      .send({ avatarId: "avatar-99" })
      .expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const secondSession = await login(ctx.app, "avatar-student");
    const me = await secondSession.agent.get("/api/auth/me").expect(200);
    expect(me.body.data.avatarId).toBe("avatar-06");
    expect(me.body.data).not.toHaveProperty("avatarUrl");

    const seller = await secondSession.agent
      .get(`/api/sellers/${secondSession.user.id}`)
      .expect(200);
    expect(seller.body.data.avatarId).toBe("avatar-06");
    expect(seller.body.data).not.toHaveProperty("avatarUrl");
  });

  it("unlocks first-listing avatars once, persists them, and rejects locked reward selection", async () => {
    const seller = await login(ctx.app, "avatar-achievement-seller");
    await verifyPhone(seller, "9876543219");
    expect((await seller.agent.get("/api/auth/me").expect(200)).body.data.avatarAchievements).toEqual([]);

    const locked = await seller.agent
      .patch("/api/auth/me/avatar")
      .set(seller.headers)
      .send({ avatarId: "unlock_listing_female" })
      .expect(403);
    expect(locked.body.error.code).toBe("AVATAR_LOCKED");

    const first = await createDraft(seller, ctx.category.id);
    await uploadImage(seller, first.id);
    const submitted = await seller.agent
      .post(`/api/listings/${first.id}/submit`)
      .set(seller.headers)
      .expect(200);
    expect(submitted.body.data.avatarAchievementUnlocked).toBe("FIRST_LISTING");

    const second = await createDraft(seller, ctx.category.id, { title: "Second listing textbook" });
    await uploadImage(seller, second.id);
    const repeated = await seller.agent
      .post(`/api/listings/${second.id}/submit`)
      .set(seller.headers)
      .expect(200);
    expect(repeated.body.data.avatarAchievementUnlocked).toBeNull();

    expect(await ctx.db.select().from(schema.userAchievements)
      .where(eq(schema.userAchievements.userId, seller.user.id))).toHaveLength(1);
    const unlockNotifications = await ctx.db.select().from(schema.notifications)
      .where(eq(schema.notifications.type, "AVATAR_UNLOCKED"));
    expect(unlockNotifications).toHaveLength(1);
    expect(unlockNotifications[0]).toMatchObject({
      userId: seller.user.id,
      title: "New avatar unlocked ✨",
      body: "Your first listing unlocked new profile avatars.",
      href: "/profile?avatar=choose",
    });

    await seller.agent
      .patch("/api/auth/me/avatar")
      .set(seller.headers)
      .send({ avatarId: "unlock_listing_female" })
      .expect(200);
    await seller.agent
      .patch("/api/auth/me/avatar")
      .set(seller.headers)
      .send({ avatarId: "unlock_purchase_female" })
      .expect(403);

    const nextSession = await login(ctx.app, "avatar-achievement-seller");
    const me = await nextSession.agent.get("/api/auth/me").expect(200);
    expect(me.body.data.avatarId).toBe("unlock_listing_female");
    expect(me.body.data.avatarAchievements).toEqual(["FIRST_LISTING"]);
  });
});
