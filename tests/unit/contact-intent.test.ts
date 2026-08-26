// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePendingContact, pendingContact, savePendingContact } from "../../apps/web/src/contact-intent";

describe("pending contact intent", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("stores and consumes a contact intent exactly once", () => {
    savePendingContact("listing-1");
    expect(pendingContact()).toMatchObject({ listingId: "listing-1", returnTo: "/listing/listing-1" });
    expect(consumePendingContact("listing-1")).toBe(true);
    expect(consumePendingContact("listing-1")).toBe(false);
  });

  it("removes contact intents after fifteen minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
    savePendingContact("listing-2");
    vi.setSystemTime(new Date("2026-08-26T12:16:00Z"));
    expect(pendingContact()).toBeNull();
  });

  it("clears legacy pending-purchase data without creating a contact intent", () => {
    window.sessionStorage.setItem("uni-market:pending-purchase:v1", JSON.stringify({ listingId: "legacy" }));
    expect(pendingContact()).toBeNull();
    expect(window.sessionStorage.getItem("uni-market:pending-purchase:v1")).toBeNull();
  });
});
