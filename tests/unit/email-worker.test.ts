import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../apps/api/src/config";
import * as schema from "../../apps/api/src/db/schema";
import { setup } from "../integration/helper";

const { createTransport, sendMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { EmailWorker } from "../../apps/api/src/services/email";

type EmailJob = {
  job: { id: string; template: string; attempts: number };
  recipient: string;
  displayName: string;
  preferences?: {
    enabled: boolean;
    listingUpdates: boolean;
    transactionUpdates: boolean;
    messageUpdates: boolean;
    policyReminders: boolean;
  };
};

function fakeDatabase(jobs: EmailJob[]) {
  const updates: Array<Record<string, unknown>> = [];
  const forUpdate = vi.fn().mockResolvedValue(jobs);
  const limit = vi.fn(() => ({ for: forUpdate }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const secondLeftJoin = vi.fn(() => ({ where }));
  const leftJoin = vi.fn(() => ({ leftJoin: secondLeftJoin }));
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  const db = { select, update } as any;
  db.transaction = vi.fn((operation) => operation(db));
  return { db, updates, forUpdate };
}

const smtpConfig = () =>
  loadConfig({
    NODE_ENV: "test",
    DEV_MODE: "false",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "2525",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM_NAME: "Uni Market Test",
    SMTP_FROM_EMAIL: "market@example.test",
  });

describe("EmailWorker", () => {
  beforeEach(() => {
    createTransport.mockReset();
    sendMail.mockReset();
    createTransport.mockReturnValue({ sendMail });
  });

  it("leaves queued mail untouched when SMTP is not configured", async () => {
    const { db } = fakeDatabase([]);
    const worker = new EmailWorker(
      db,
      loadConfig({ NODE_ENV: "test", DEV_MODE: "false" }),
    );

    await worker.runOnce();

    expect(createTransport).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("delivers queued mail and marks it sent after one attempt", async () => {
    const { db, updates, forUpdate } = fakeDatabase([
      {
        job: { id: "job-1", template: "listing_approved", attempts: 0 },
        recipient: "student@example.edu",
        displayName: "Student",
      },
    ]);
    sendMail.mockResolvedValue({ messageId: "message-1" });

    await new EmailWorker(db, smtpConfig()).runOnce();

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 2525,
      secure: false,
      auth: { user: "smtp-user", pass: "smtp-password" },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Uni Market Test" <market@example.test>',
        to: "student@example.edu",
        subject: "Your listing was approved: your listing",
        text: expect.stringContaining("Hi Student,\n\nYour listing is live"),
        html: expect.stringContaining("Your listing is live"),
      }),
    );
    expect(forUpdate).toHaveBeenCalledWith("update", {
      of: expect.anything(),
      skipLocked: true,
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      availableAt: expect.any(Date),
      attempts: 1,
    });
    expect(updates[1]).toMatchObject({ sentAt: expect.any(Date) });
  });

  it("backs off transient failures and permanently fails the fifth attempt", async () => {
    const { db, updates } = fakeDatabase([
      {
        job: { id: "job-retry", template: "support-response", attempts: 1 },
        recipient: "retry@example.edu",
        displayName: "Retry Student",
      },
      {
        job: { id: "job-final", template: "unknown-template", attempts: 4 },
        recipient: "failed@example.edu",
        displayName: "Failed Student",
      },
    ]);
    sendMail
      .mockRejectedValueOnce(new Error("temporary SMTP failure"))
      .mockRejectedValueOnce(new Error("permanent SMTP failure"));
    const before = Date.now();

    await new EmailWorker(db, smtpConfig()).runOnce();

    const failures = updates.filter((update) => "lastError" in update);
    expect(failures[0]).toMatchObject({
      lastError: "temporary SMTP failure",
      availableAt: expect.any(Date),
    });
    expect((failures[0]?.availableAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 4 * 60_000,
    );
    expect(failures[0]).not.toHaveProperty("failedAt");
    expect(failures[1]).toMatchObject({
      lastError: "permanent SMTP failure",
      failedAt: expect.any(Date),
    });
    expect(failures[1]).not.toHaveProperty("availableAt");
  });

  it("claims an outbox job once across overlapping workers", async () => {
    const ctx = await setup();
    try {
      const recipient = (
        await ctx.db
          .insert(schema.users)
          .values({ email: "worker-race@example.edu", displayName: "Worker Race" })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.emailOutbox).values({
        recipientUserId: recipient.id,
        template: "support-response",
        payload: {},
        dedupeKey: "worker-race",
      });
      sendMail.mockResolvedValue({ messageId: "message-race" });

      await Promise.all([
        new EmailWorker(ctx.db, smtpConfig()).runOnce(),
        new EmailWorker(ctx.db, smtpConfig()).runOnce(),
      ]);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const job = (await ctx.db.select().from(schema.emailOutbox))[0]!;
      expect(job.attempts).toBe(1);
      expect(job.sentAt).toBeInstanceOf(Date);
    } finally {
      await ctx.client.close();
    }
  });

  it("never claims legacy student-email OTP jobs for SMTP delivery", async () => {
    const ctx = await setup();
    try {
      const recipient = (
        await ctx.db
          .insert(schema.users)
          .values({ email: "student-otp@example.edu", displayName: "Student OTP" })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.emailOutbox).values({
        recipientUserId: recipient.id,
        template: "student-email-otp",
        payload: {},
        dedupeKey: "legacy-student-email-otp",
      });

      await new EmailWorker(ctx.db, smtpConfig()).runOnce();

      expect(sendMail).not.toHaveBeenCalled();
      const job = (await ctx.db.select().from(schema.emailOutbox))[0]!;
      expect(job.attempts).toBe(0);
      expect(job.sentAt).toBeNull();
    } finally {
      await ctx.client.close();
    }
  });

  it("suppresses an optional email when the recipient disabled its category", async () => {
    const ctx = await setup();
    try {
      const recipient = (
        await ctx.db.insert(schema.users).values({ email: "email-opt-out@example.edu", displayName: "Opted Out" }).returning()
      )[0]!;
      await ctx.db.insert(schema.emailPreferences).values({ userId: recipient.id, listingUpdates: false });
      await ctx.db.insert(schema.emailOutbox).values({
        recipientUserId: recipient.id,
        template: "listing_approved",
        payload: { listingId: crypto.randomUUID(), listingTitle: "Desk lamp" },
        dedupeKey: "suppressed-listing-update",
      });

      await new EmailWorker(ctx.db, smtpConfig()).runOnce();

      expect(sendMail).not.toHaveBeenCalled();
      const job = (await ctx.db.select().from(schema.emailOutbox))[0]!;
      expect(job.suppressedAt).toBeInstanceOf(Date);
      expect(job.suppressionReason).toBe("preference:listingUpdates");
      expect(job.sentAt).toBeNull();
    } finally {
      await ctx.client.close();
    }
  });
});
