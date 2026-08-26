import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_BASE_PATH,
  marketplaceUrl,
} from "../../apps/api/src/lib/marketplace-url";

describe("marketplace application URLs", () => {
  it("keeps the client origin while adding the marketplace base path", () => {
    expect(MARKETPLACE_BASE_PATH).toBe("/marketplace");
    expect(
      marketplaceUrl("https://uni.rocks", "/requests?view=sent#request-1"),
    ).toBe(
      "https://uni.rocks/marketplace/requests?view=sent#request-1",
    );
  });

  it("links the application home under the marketplace path", () => {
    expect(marketplaceUrl("https://uni.rocks", "/")).toBe(
      "https://uni.rocks/marketplace/",
    );
  });
});
