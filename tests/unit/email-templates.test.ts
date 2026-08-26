import { describe, expect, it } from "vitest";
import { loadConfig } from "../../apps/api/src/config";
import { renderEmail } from "../../apps/api/src/services/email-templates";

const config = loadConfig({
  NODE_ENV: "test",
  DEV_MODE: "false",
  CLIENT_URL: "https://uni.rocks",
  SMTP_FROM_EMAIL: "no-reply@uni.rocks",
});

describe("email templates", () => {
  it("renders branded HTML, plain text, a CTA, and the preference link for optional updates", () => {
    const rendered = renderEmail({
      template: "purchase-request",
      displayName: "Seller",
      payload: { transactionId: "transaction-id", listingId: "listing-id", listingTitle: "Study table" },
      config,
    });

    expect(rendered.subject).toBe("New reservation request: Study table");
    expect(rendered.text).toContain("Hi Seller,");
    expect(rendered.text).toContain("https://uni.rocks/marketplace/requests?view=received");
    expect(rendered.html).toContain("<span style=\"color:#8a4f68;\">Uni</span> Market");
    expect(rendered.html).toContain("Manage email notifications");
    expect(rendered.html).toContain("https://uni.rocks/marketplace/settings?section=email");
  });

  it("escapes dynamic content and does not put preference controls on essential support mail", () => {
    const listing = renderEmail({
      template: "listing_rejected",
      payload: { listingTitle: "<img src=x onerror=alert(1)>", reason: "Use <script>bad()</script>" },
      config,
    });
    const support = renderEmail({ template: "support-response", payload: { ticketId: "ticket-id" }, config });

    expect(listing.html).not.toContain("<script>bad()</script>");
    expect(listing.html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(listing.subject).not.toContain("\n");
    expect(support.html).not.toContain("Manage email notifications");
    expect(support.text).not.toContain("Manage email notifications");
  });
});
