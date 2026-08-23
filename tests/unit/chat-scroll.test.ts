import { describe, expect, it } from "vitest";
import { shouldFollowNewMessage } from "../../apps/web/src/chat-scroll";

describe("chat scroll behavior", () => {
  it("follows incoming messages while the reader is near the bottom", () => {
    expect(shouldFollowNewMessage(true, "seller", "buyer")).toBe(true);
  });

  it("does not pull the reader away from older messages", () => {
    expect(shouldFollowNewMessage(false, "seller", "buyer")).toBe(false);
  });

  it("keeps the sender's own optimistic message in view", () => {
    expect(shouldFollowNewMessage(false, "buyer", "buyer")).toBe(true);
  });
});
