import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { login, setup } from "./helper";

let ctx: Awaited<ReturnType<typeof setup>>;
let user: Awaited<ReturnType<typeof login>>;

beforeEach(async () => {
  ctx = await setup();
  user = await login(ctx.app, "email-preferences-user");
});

afterEach(async () => ctx?.client.close());

describe("email preferences", () => {
  it("returns enabled defaults and persists granular choices behind authentication", async () => {
    const defaults = await user.agent.get("/api/email-preferences").expect(200);
    expect(defaults.body.data).toMatchObject({
      enabled: true,
      listingUpdates: true,
      transactionUpdates: true,
      messageUpdates: true,
      policyReminders: true,
      updatedAt: null,
    });

    await user.agent.patch("/api/email-preferences").set(user.headers).send({ listingUpdates: false, messageUpdates: false }).expect(200);
    await user.agent.patch("/api/email-preferences").set(user.headers).send({ enabled: false }).expect(200);
    const stored = await user.agent.get("/api/email-preferences").expect(200);
    expect(stored.body.data).toMatchObject({ enabled: false, listingUpdates: false, messageUpdates: false, transactionUpdates: true });

    const exported = await user.agent.get("/api/account/export").expect(200);
    expect(exported.body.emailPreferences).toMatchObject({ enabled: false, listingUpdates: false, messageUpdates: false });
  });

  it("rejects empty and unknown preference updates", async () => {
    await user.agent.patch("/api/email-preferences").set(user.headers).send({}).expect(400);
    await user.agent.patch("/api/email-preferences").set(user.headers).send({ promotions: false }).expect(400);
  });
});
