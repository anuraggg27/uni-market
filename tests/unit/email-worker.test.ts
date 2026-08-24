import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../apps/api/src/config";

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
};

function fakeDatabase(jobs: EmailJob[]) {
  const updates: Array<Record<string, unknown>> = [];
  const limit = vi.fn().mockResolvedValue(jobs);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  return { db: { select, update } as any, updates };
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
    const { db, updates } = fakeDatabase([
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
        subject: "Your listing was approved",
        text: expect.stringContaining("Student,\n\nYour listing passed manual review"),
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ sentAt: expect.any(Date), attempts: 1 });
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

    expect(updates[0]).toMatchObject({
      attempts: 2,
      lastError: "temporary SMTP failure",
      availableAt: expect.any(Date),
    });
    expect((updates[0]?.availableAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 4 * 60_000,
    );
    expect(updates[0]).not.toHaveProperty("failedAt");
    expect(updates[1]).toMatchObject({
      attempts: 5,
      lastError: "permanent SMTP failure",
      failedAt: expect.any(Date),
    });
    expect(updates[1]).not.toHaveProperty("availableAt");
  });
});
