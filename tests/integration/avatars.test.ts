import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login, setup } from "./helper";

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

    const seller = await secondSession.agent
      .get(`/api/sellers/${secondSession.user.id}`)
      .expect(200);
    expect(seller.body.data.avatarId).toBe("avatar-06");
  });
});
