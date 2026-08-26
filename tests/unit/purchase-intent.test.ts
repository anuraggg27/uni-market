// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePendingPurchase, pendingPurchase, savePendingPurchase } from "../../apps/web/src/purchase-intent";

describe("pending purchase intent", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("stores and consumes a purchase exactly once", () => {
    savePendingPurchase("listing-1");
    expect(pendingPurchase()).toMatchObject({ listingId: "listing-1", returnTo: "/listing/listing-1" });
    expect(consumePendingPurchase("listing-1")).toBe(true);
    expect(consumePendingPurchase("listing-1")).toBe(false);
  });

  it("removes purchase intents after fifteen minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
    savePendingPurchase("listing-2");
    vi.setSystemTime(new Date("2026-08-26T12:16:00Z"));
    expect(pendingPurchase()).toBeNull();
  });
});
