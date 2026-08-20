import { describe, expect, it } from "vitest";
import { postLoginDestination } from "../../apps/web/src/auth-routing";

describe("postLoginDestination", () => {
  it("sends a super admin with a completed profile to the admin portal", () => {
    expect(
      postLoginDestination({
        onboardingComplete: true,
        roles: ["USER", "SUPER_ADMIN"],
      }),
    ).toBe("/admin");
  });

  it("keeps onboarding mandatory before staff access", () => {
    expect(
      postLoginDestination({
        onboardingComplete: false,
        roles: ["USER", "SUPER_ADMIN"],
      }),
    ).toBe("/onboarding");
  });

  it("returns users to the protected page they originally requested", () => {
    expect(
      postLoginDestination(
        { onboardingComplete: true, roles: ["USER", "MODERATOR"] },
        "/admin/listings/pending",
      ),
    ).toBe("/admin/listings/pending");
  });

  it("sends regular users to the marketplace home page", () => {
    expect(
      postLoginDestination({ onboardingComplete: true, roles: ["USER"] }),
    ).toBe("/");
  });
});
