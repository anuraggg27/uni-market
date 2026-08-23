import { describe, expect, it } from "vitest";
import {
  msg91AccessToken,
  msg91Identifier,
  msg91RequestId,
} from "../../apps/web/src/msg91";

describe("MSG91 client response handling", () => {
  it("formats Indian phone numbers without a plus sign", () => {
    expect(msg91Identifier("+91 98765 43210")).toBe("919876543210");
    expect(() => msg91Identifier("12345")).toThrow(/valid 10-digit/);
  });

  it("extracts the request ID and access token from MSG91 response shapes", () => {
    expect(
      msg91RequestId({ type: "success", message: "336870744532313134323444" }),
    ).toBe("336870744532313134323444");
    expect(msg91AccessToken({ "access-token": "header.payload.signature" })).toBe(
      "header.payload.signature",
    );
    expect(() => msg91AccessToken({ type: "success" })).toThrow(
      /verification token/,
    );
  });
});
