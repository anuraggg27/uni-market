import {
  expect,
  test,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "4000"}`;
async function signIn(
  context: BrowserContext,
  credential: string,
  { profile = true, phone = true } = {},
) {
  const request = context.request;
  await request.post(`${API}/api/auth/google`, {
    data: { credential: credential.padEnd(24, "x") },
  });
  const csrf = (await (await request.get(`${API}/api/auth/csrf`)).json()).data
    .csrfToken;
  const headers = { "x-csrf-token": csrf };
  if (profile)
    await request.post(`${API}/api/onboarding/complete`, {
      headers,
      data: {
        displayName: credential,
        institution: "Open University",
        campus: "Main campus",
        graduationYear: 2028,
        adultAttested: true,
        acceptTerms: true,
        acknowledgePrivacy: true,
        acceptCommunityRules: true,
        policyVersion: "2026-08-25",
      },
    });
  if (phone) {
    const suffix = String(
      (Math.abs(hash(credential)) % 9000000000) + 1000000000,
    ).slice(0, 10);
    const valid = `9${suffix.slice(1)}`;
    await request.post(`${API}/api/phone/send`, {
      headers,
      data: { phone: valid },
    });
    await request.post(`${API}/api/phone/verify`, {
      headers,
      data: { phone: valid, code: "999999" },
    });
    const studentEmail = `${credential.replace(/[^a-z0-9]/gi, "").toLowerCase()}@students.example.edu`;
    await request.post(`${API}/api/student-email/send`, {
      headers,
      data: { email: studentEmail },
    });
    await request.post(`${API}/api/student-email/verify`, {
      headers,
      data: { email: studentEmail, code: "999999" },
    });
  }
  return { request, headers };
}
function hash(value: string) {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) | 0;
  return result;
}
async function category(request: APIRequestContext) {
  return (
    (await (await request.get(`${API}/api/categories`)).json()).data as any[]
  )[0].id as string;
}
async function createListing(
  auth: Awaited<ReturnType<typeof signIn>>,
  title: string,
  { submit = true } = {},
) {
  const categoryId = await category(auth.request);
  const created = await auth.request.post(`${API}/api/listings`, {
    headers: auth.headers,
    data: {
      title,
      description:
        "A genuine used student product in good condition with all important details included.",
      categoryId,
      condition: "GOOD",
      conditionExplanation: "",
      priceType: "FIXED",
      exactPrice: 650,
      negotiable: true,
      location: "Main campus",
      brand: "StudyCo",
      defects: "",
      meetupPoint: "Library entrance",
      ownershipAttested: true,
      usedPhysicalGoodsAttested: true,
      accurateDescriptionAttested: true,
      sellerPolicyAccepted: true,
    },
  });
  const listing = (await created.json()).data;
  const image = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#5b7f68" },
  })
    .jpeg()
    .toBuffer();
  const presign = (
    await (
      await auth.request.post(
        `${API}/api/uploads/listings/${listing.id}/presign`,
        {
          headers: auth.headers,
          data: { mimeType: "image/jpeg", byteSize: image.length, syntheticStatus: "NOT_SYNTHETIC" },
        },
      )
    ).json()
  ).data;
  await auth.request.put(presign.uploadUrl, {
    headers: { "content-type": "image/jpeg" },
    data: image,
  });
  await auth.request.post(
    `${API}/api/uploads/listings/${listing.id}/finalize`,
    { headers: auth.headers, data: { imageId: presign.imageId } },
  );
  if (submit)
    await auth.request.post(`${API}/api/listings/${listing.id}/submit`, {
      headers: auth.headers,
    });
  return listing;
}
async function approve(
  context: BrowserContext,
  listingId: string,
  decision = "APPROVE",
  userVisibleReason?: string,
) {
  const auth = await signIn(context, "moderator");
  const response = await auth.request.post(
    `${API}/api/admin/listings/${listingId}/decision`,
    {
      headers: auth.headers,
      data: {
        decision,
        internalReason: "E2E moderation review completed",
        userVisibleReason,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

test("E2E-01 seller journey from onboarding through moderator approval", async ({
  browser,
}) => {
  const seller = await browser.newContext();
  await signIn(seller, "seller-journey", { profile: false, phone: false });
  const page = await seller.newPage();
  await page.goto("/onboarding");
  await page.getByLabel("Display name").fill("Journey Seller");
  await page.getByLabel(/I declare that I am at least 18/).check();
  await page.getByLabel(/I accept the Terms of use/).check();
  await page.getByLabel(/I have read the Privacy notice/).check();
  await page.getByLabel(/I accept the Community rules/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/settings/);
  await page.getByLabel("Indian mobile number").fill("9876500001");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("999999");
  await page.getByRole("button", { name: "Verify phone" }).click();
  await expect(page.getByText("Your phone is verified")).toBeVisible();
  await page.getByLabel("Student email").fill("journey@students.example.edu");
  await page.getByRole("button", { name: "Send email code" }).click();
  await page.getByLabel("6-digit email code").fill("999999");
  await page.getByRole("button", { name: "Verify student email" }).click();
  await expect(page.getByText(/@students\.example\.edu is verified/)).toBeVisible();
  await page.goto("/sell");
  await page.getByLabel("Title").fill("Engineering mechanics book");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(
      "A clean engineering mechanics textbook with no missing pages or annotations.",
    );
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Price (₹)").fill("650");
  await page
    .getByLabel("Campus, hostel area or neighbourhood")
    .fill("Main campus");
  const image = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#355e4b" },
  })
    .jpeg()
    .toBuffer();
  await page
    .getByLabel(/Product images/)
    .setInputFiles([
      { name: "book.jpg", mimeType: "image/jpeg", buffer: image },
      { name: "book-detail.jpg", mimeType: "image/jpeg", buffer: image },
    ]);
  await expect(
    page.getByAltText("Selected product image: book.jpg"),
  ).toBeVisible();
  await page.getByLabel(/I own this item/).check();
  await page.getByLabel(/This is a used physical good/).check();
  await page.getByLabel(/description, condition, defects/).check();
  await page.getByLabel(/I accept the Seller policy/).check();
  await expect(
    page.getByAltText("Selected product image: book-detail.jpg"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove book-detail.jpg" }).click();
  await expect(
    page.getByAltText("Selected product image: book-detail.jpg"),
  ).toHaveCount(0);
  await expect(
    page.getByAltText("Selected product image: book.jpg"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page).toHaveURL(/listing\//);
  const listingId = page.url().split("/").pop()!;
  await page.goto("/my-listings");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("PENDING").first()).toBeVisible();
  const mod = await browser.newContext();
  await approve(mod, listingId);
  await page.goto(`/listing/${listingId}`);
  await expect(
    page.getByRole("heading", { name: "Engineering mechanics book", level: 1 }),
  ).toBeVisible();
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto("/browse");
  await expect(guestPage.getByText("Engineering mechanics book")).toBeVisible();
  await seller.close();
  await mod.close();
  await guest.close();
});

test("E2E-02 rejected listing is corrected, resubmitted and approved", async ({
  browser,
}) => {
  const seller = await browser.newContext();
  const auth = await signIn(seller, "rejected-seller");
  const listing = await createListing(auth, "Old calculator");
  const mod = await browser.newContext();
  await approve(
    mod,
    listing.id,
    "REJECT",
    "Please describe the battery condition.",
  );
  const page = await seller.newPage();
  await page.goto(`/listing/${listing.id}`);
  await expect(
    page.getByText("Please describe the battery condition."),
  ).toBeVisible();
  await page.goto(`/listing/${listing.id}/edit`);
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(
      "A working calculator with a recently replaced battery and clear display.",
    );
  await page.getByLabel(/I own this item/).check();
  await page.getByLabel(/This is a used physical good/).check();
  await page.getByLabel(/description, condition, defects/).check();
  await page.getByLabel(/I accept the Seller policy/).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.goto("/my-listings");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await approve(mod, listing.id);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/listing/${listing.id}`);
  await expect(
    guestPage.getByRole("heading", { name: "Old calculator", level: 1 }),
  ).toBeVisible();
  await seller.close();
  await mod.close();
  await guest.close();
});

test("E2E-03 buyer transaction, chat, reservation, completion and reviews", async ({
  browser,
}) => {
  const seller = await browser.newContext();
  const sellerAuth = await signIn(seller, "transaction-seller");
  const listing = await createListing(sellerAuth, "Graphing calculator");
  const mod = await browser.newContext();
  await approve(mod, listing.id);
  const buyer = await browser.newContext();
  await signIn(buyer, "transaction-buyer");
  const buyerPage = await buyer.newPage();
  const sellerPage = await seller.newPage();
  await sellerPage.goto("/chats");
  await expect(
    sellerPage.getByRole("heading", { name: "No conversations" }),
  ).toBeVisible();
  await buyerPage.goto(`/listing/${listing.id}`);
  await buyerPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    buyerPage.getByRole("button", { name: "Unsave item" }),
  ).toBeVisible();
  await expect(
    buyerPage.getByRole("status").filter({ hasText: "Saved to your favourites" }),
  ).toBeVisible();
  await buyerPage.getByRole("button", { name: "Unsave item" }).click();
  await expect(
    buyerPage.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(
    buyerPage.getByRole("status").filter({ hasText: "Removed from saved" }),
  ).toBeVisible();
  await buyerPage.getByRole("button", { name: "Save", exact: true }).click();
  await buyerPage.getByRole("button", { name: "Contact seller" }).click();
  await expect(buyerPage).toHaveURL(/chats/);
  await buyerPage
    .getByLabel("Message")
    .fill("Can we meet at the library tomorrow?");
  await buyerPage.getByRole("button", { name: "Send" }).click();
  await expect(
    buyerPage.getByText("Can we meet at the library tomorrow?"),
  ).toBeVisible();
  const conversationPath = new URL(buyerPage.url()).pathname;
  await expect(
    sellerPage.getByText(/^(Live|Connecting|Retrying|Reconnecting)$/),
  ).toHaveCount(0);
  await expect(
    sellerPage.getByRole("link", { name: /transaction-buyer/ }),
  ).toBeVisible();
  await buyerPage
    .getByLabel("Message")
    .fill("I can bring the exact amount if it is available.");
  await buyerPage.getByRole("button", { name: "Send" }).click();
  await expect(sellerPage.getByLabel("2 unread messages")).toBeVisible();
  await sellerPage.getByRole("link", { name: /transaction-buyer/ }).click();
  await expect(sellerPage).toHaveURL(new RegExp(`${conversationPath}$`));
  await expect(
    sellerPage.getByText("I can bring the exact amount if it is available."),
  ).toBeVisible();
  await buyerPage
    .getByLabel("Message")
    .fill("Does 4 PM work for you?");
  await buyerPage.getByRole("button", { name: "Send" }).click();
  await expect(sellerPage.getByText("Does 4 PM work for you?")).toBeVisible();
  await sellerPage.setViewportSize({ width: 390, height: 844 });
  await expect(
    sellerPage.getByRole("link", { name: "Back to chats" }),
  ).toBeVisible();
  const sendButtonRadius = await sellerPage
    .getByRole("button", { name: "Send" })
    .evaluate((button) => getComputedStyle(button).borderRadius);
  expect(sendButtonRadius).toBe("9px");
  expect(
    await sellerPage.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await buyerPage.goto(`/listing/${listing.id}`);
  await buyerPage.getByRole("button", { name: "Buy", exact: true }).click();
  await sellerPage.goto("/transactions");
  await sellerPage.getByRole("button", { name: "Accept and reserve" }).click();
  await sellerPage.getByRole("button", { name: "Mark handed over" }).click();
  await buyerPage.goto("/transactions");
  await buyerPage.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(buyerPage.getByText("COMPLETED")).toBeVisible();
  await buyerPage
    .getByLabel("Short review")
    .fill("Exactly as described and easy meetup.");
  await buyerPage
    .getByRole("button", { name: "Leave verified review" })
    .click();
  await expect(buyerPage.getByText("Review submitted.")).toBeVisible();
  await seller.close();
  await buyer.close();
  await mod.close();
});

test("E2E-04 report, removal, seller notification and audit trail", async ({
  browser,
}) => {
  const seller = await browser.newContext();
  const sellerAuth = await signIn(seller, "reported-seller");
  const listing = await createListing(sellerAuth, "Reported product");
  const mod = await browser.newContext();
  await approve(mod, listing.id);
  const reporter = await browser.newContext();
  await signIn(reporter, "reporting-user");
  const page = await reporter.newPage();
  await page.goto(`/listing/${listing.id}`);
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByLabel("Reason").selectOption("MISLEADING_INFORMATION");
  await page
    .getByRole("textbox", { name: "Details", exact: true })
    .fill("This listing appears misleading.");
  await page.getByRole("button", { name: "Submit report" }).click();
  const moderator = await mod.newPage();
  await moderator.goto("/admin/reports");
  await expect(moderator.getByText("MISLEADING INFORMATION")).toBeVisible();
  await approve(
    mod,
    listing.id,
    "REMOVE",
    "Removed after a confirmed misleading listing report.",
  );
  const guest = await browser.newContext();
  await (await guest.newPage()).goto(`/listing/${listing.id}`);
  await expect(
    (await guest.pages())[0].getByText("This listing is unavailable"),
  ).toBeVisible();
  const sellerPage = await seller.newPage();
  await sellerPage.goto("/notifications");
  await expect(sellerPage.getByText("Listing removed")).toBeVisible();
  await moderator.goto("/admin/audit-logs");
  await expect(moderator.getByText("LISTING_REMOVE")).toBeVisible();
  await seller.close();
  await reporter.close();
  await mod.close();
  await guest.close();
});

test("E2E-05 support request receives an agent response and resolves", async ({
  browser,
}) => {
  const user = await browser.newContext();
  await signIn(user, "support-user");
  const page = await user.newPage();
  await page.goto("/support");
  await page.getByLabel("Subject").fill("Listing status question");
  await page
    .getByLabel("Describe the issue")
    .fill(
      "My listing status has not changed and I would like help understanding it.",
    );
  await page.getByRole("button", { name: "Open request" }).click();
  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
  const ticketId = page.url().split("/").pop()!;
  const support = await browser.newContext();
  await signIn(support, "support");
  const agent = await support.newPage();
  await agent.goto(`/admin/support/${ticketId}`);
  await agent
    .getByLabel("Reply")
    .fill("Your listing is still in the normal review queue.");
  await agent.getByLabel("New status").selectOption("RESOLVED");
  await agent.getByRole("button", { name: "Send reply" }).click();
  await page.reload();
  await expect(
    page.getByText("Your listing is still in the normal review queue."),
  ).toBeVisible();
  await expect(page.getByText("RESOLVED")).toBeVisible();
  await user.close();
  await support.close();
});

test("E2E-06 public grievance submission returns private tracking access", async ({
  browser,
}) => {
  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.goto("/grievance");
  await page.getByLabel("Your email").fill("grievance-reporter@example.com");
  await page.getByLabel("Issue category").selectOption("OTHER");
  await page
    .getByLabel("Uni Market link to the listing, profile, message, or content (optional)")
    .fill(`${page.url().split("/grievance")[0]}/listing/reported-content`);
  await page
    .getByLabel("What happened?")
    .fill("This report verifies the complete public grievance and private tracking flow.");
  await page.getByRole("button", { name: "Submit Grievance" }).click();
  await expect(page.getByRole("heading", { name: "Keep these details safe" })).toBeVisible();

  const reference = (await page.locator("dd code").nth(0).textContent())!;
  const trackingSecret = (await page.locator("dd code").nth(1).textContent())!;
  await page.getByRole("link", { name: "Track This Case" }).click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByLabel("Tracking secret").fill(trackingSecret);
  await page.getByRole("button", { name: "View Case Status" }).click();
  await expect(page.getByRole("heading", { name: "Open" })).toBeVisible();
  await expect(page.getByText("Your grievance was received and queued for review.")).toBeVisible();
  await guest.close();
});

test("E2E-07 important marketplace screens remain usable at mobile, tablet and desktop widths", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const path of [
      "/",
      "/browse",
      "/leaderboard",
      "/login",
      "/terms",
      "/privacy",
      "/seller-policy",
      "/marketplace-disclosure",
    ]) {
      await page.goto(path);
      if (path === "/") {
        const searchFontSize = await page
          .getByLabel("Search products")
          .evaluate(
            (input) => getComputedStyle(input, "::placeholder").fontSize,
          );
        expect(searchFontSize).toBe(viewport.width < 640 ? "14px" : "16px");
      }
      if (path === "/terms") {
        await expect(page.getByRole("heading", { name: "Independent platform" })).toBeVisible();
        await expect(page.getByText("Policy version")).toHaveCount(0);
        await expect(page.getByText("Platform operator")).toHaveCount(0);
      }
      if (path === "/seller-policy") {
        await expect(page.getByText(/not affiliated with, endorsed by/)).toHaveCount(0);
      }
      if (path === "/privacy") {
        await expect(page.getByRole("link", { name: "privacy@uni.rocks" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Sharing" })).toBeVisible();
        await expect(page.getByText("Sharing & processors")).toHaveCount(0);
      }
      if (path === "/marketplace-disclosure") {
        await expect(page.getByRole("heading", { name: "Service providers" })).toHaveCount(0);
      }
      if (path === "/browse") {
        await expect(page.getByText("Only manually approved listings appear here.")).toHaveCount(0);
        await expect(page.getByText("How results are ordered")).toHaveCount(0);
      }
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows at ${viewport.width}`).toBe(false);
      await expect(page.locator("main")).toBeVisible();
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        accessibility.violations,
        `${path} has accessibility violations`,
      ).toEqual([]);
    }
    expect(pageErrors).toEqual([]);
    await context.close();
  }
});
