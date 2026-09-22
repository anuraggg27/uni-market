import { expect, test, type BrowserContext } from "@playwright/test";

const API = "http://127.0.0.1:" + (process.env.E2E_API_PORT ?? "4000");
const ADMIN_SECTION_ROUTES = [
  "/marketplace/admin",
  "/marketplace/admin/listings/pending",
  "/marketplace/admin/listings",
  "/marketplace/admin/reports",
  "/marketplace/admin/grievances",
  "/marketplace/admin/users",
  "/marketplace/admin/reviews",
  "/marketplace/admin/support",
  "/marketplace/admin/audit-logs",
  "/marketplace/admin/categories",
  "/marketplace/admin/compliance",
] as const;

async function signInAsAdmin(context: BrowserContext) {
  const request = context.request;
  await request.post(API + "/api/auth/google", {
    data: { credential: "moderator".padEnd(24, "x") },
  });
  const csrf = (await (await request.get(API + "/api/auth/csrf")).json()).data
    .csrfToken;
  const domains = (
    await (await request.get(API + "/api/academic-domains")).json()
  ).data as Array<{ id: string; domain: string }>;
  const academicDomain = domains.find(
    (entry) => entry.domain === "students.example.edu",
  );
  expect(academicDomain).toBeTruthy();
  await request.post(API + "/api/onboarding/complete", {
    headers: { "x-csrf-token": csrf },
    data: {
      avatarId: "avatar-01",
      displayName: "Dashboard Admin",
      academicDomainId: academicDomain!.id,
      campus: "Main campus",
      graduationYear: 2028,
      adultAttested: true,
      acceptTerms: true,
      acknowledgePrivacy: true,
      acceptCommunityRules: true,
      policyVersion: "2026-08-27",
    },
  });
}

test("admin dashboard preserves real data and stays responsive at supported widths", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/analytics?range=90", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          range: "90",
          from: "2026-09-20",
          to: "2026-09-22",
          trackingStartedAt: "2026-09-20",
          summary: { uniqueVisitors: 10, averageDailyVisitors: 4, peakDailyVisitors: 6, todayVisitors: 5 },
          series: [
            { date: "2026-09-20", visitors: 3 },
            { date: "2026-09-21", visitors: 4 },
            { date: "2026-09-22", visitors: 5 },
          ],
          topPages: [{ route: "/browse", visitors: 8 }, { route: "/listing/:id", visitors: 6 }],
          referrers: [{ source: "Direct", visits: 7 }, { source: "Organic search", visits: 3 }],
          devices: [{ device: "mobile", visitors: 8 }, { device: "desktop", visitors: 2 }],
        },
      }),
    });
  });
  await page.goto("/marketplace/admin");

  await expect(
    page.getByRole("heading", { level: 1, name: "Administration" }),
  ).toBeVisible();
  await expect(page.locator(".admin-summary-card")).toHaveCount(4);
  await expect(page.locator(".admin-detail-metric")).toHaveCount(13);
  await expect(page.getByRole("heading", { name: "Website traffic" })).toBeVisible();
  await expect(page.getByText("Unique visitors", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Page views")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All time" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review pending listings" }),
  ).toHaveAttribute("href", "/marketplace/admin/listings/pending");

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-console-page")).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "dashboard must not overflow at " + width + "px").toBe(false);
    if (width > 1100) {
      await expect(page.locator(".admin-sidebar")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open admin navigation" }),
      ).toBeHidden();
    } else {
      await expect(page.locator(".admin-sidebar")).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Open admin navigation" }),
      ).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("button", { name: "Open admin navigation" }).click();
  const adminDialog = page.getByRole("dialog");
  const adminLinks = adminDialog.getByRole("navigation", { name: "Admin sections" }).getByRole("link");
  await expect(adminLinks).toHaveCount(11);
  await expect(adminDialog.getByRole("link", { name: "Compliance registers" })).toBeInViewport();
  const firstLink = await adminLinks.nth(0).boundingBox();
  const secondLink = await adminLinks.nth(1).boundingBox();
  expect(firstLink).not.toBeNull();
  expect(secondLink).not.toBeNull();
  expect(Math.abs(secondLink!.x - firstLink!.x)).toBeLessThanOrEqual(1);
  expect(secondLink!.y).toBeGreaterThan(firstLink!.y);
  expect(await adminDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  for (const width of [430, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ADMIN_SECTION_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("button", { name: "Open admin navigation" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        route + " must not overflow at " + width + "px",
      ).toBe(false);
    }
  }

  await context.close();
});
test('admin user detail uses real signals and responsive card ordering', async ({ browser }) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await page.route('**/api/admin/users/' + userId, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: userId,
          displayName: 'Zoya Mehta',
          email: 'zoya@example.edu',
          avatarId: 'avatar-01',
          institution: 'Uni Market University',
          campus: 'North Campus',
          phoneE164: '+91******321',
          phoneVerifiedAt: '2026-09-01T08:00:00.000Z',
          studentEmailVerifiedAt: '2026-08-30T08:00:00.000Z',
          onboardingComplete: true,
          suspendedAt: null,
          deletedAt: null,
          closedAt: null,
          fraudInvestigation: false,
          completedSales: 3,
          lastActiveAt: '2026-09-06T09:00:00.000Z',
          createdAt: '2026-08-01T08:00:00.000Z',
          updatedAt: '2026-09-01T08:00:00.000Z',
          roles: [
            { role: 'USER', createdAt: '2026-08-01T08:00:00.000Z' },
            { role: 'SUPER_ADMIN', createdAt: '2026-09-01T08:00:00.000Z' },
          ],
        },
      }),
    });
  });
  await page.route('**/api/admin/audit-logs', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          id: 'audit-1',
          action: 'USER_ROLES_UPDATE',
          targetType: 'USER',
          targetId: userId,
          internalReason: 'Approved staff access',
          createdAt: '2026-09-01T08:00:00.000Z',
        }],
      }),
    });
  });

  await page.goto('/marketplace/admin/users/' + userId);
  await expect(page.getByRole('heading', { name: 'User profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account signals' })).toBeVisible();
  await expect(page.getByText('Approved staff access')).toBeVisible();
  await expect(page.getByRole('link', { name: /view in marketplace/i })).toHaveAttribute(
    'href',
    '/marketplace/seller/' + userId,
  );

  for (const width of [1440, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'user detail must not overflow at ' + width + 'px').toBe(false);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopColumns = await page.locator('.admin-user-detail-grid').evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  expect(desktopColumns.split(' ')).toHaveLength(2);

  await page.setViewportSize({ width: 375, height: 900 });
  const sections = page.locator('.admin-user-detail-card');
  await expect(sections.nth(0)).toHaveClass(/admin-user-overview-card/);
  await expect(sections.nth(1)).toHaveClass(/admin-user-signals-card/);
  const mobileColumns = await page.locator('.admin-user-detail-grid').evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  expect(mobileColumns.split(' ')).toHaveLength(1);
  await context.close();
});


test("pending listing queue cards and filters remain usable across breakpoints", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/listings/pending?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            listing: {
              id: "11111111-1111-4111-8111-111111111111",
              title: "Engineering calculator",
              description:
                "Scientific calculator with the original cover and manual.",
              submittedAt: "2026-09-06T10:30:00.000Z",
            },
            sellerName: "Priya Sharma",
            sellerCompletedSales: 2,
            categoryName: "Electronics",
            coverImageUrl:
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3C/svg%3E",
            flaggedTerms: [],
          },
          {
            listing: {
              id: "22222222-2222-4222-8222-222222222222",
              title: "First year textbook bundle",
              description: "Calculus and physics textbooks in good condition.",
              submittedAt: "2026-09-05T08:15:00.000Z",
            },
            sellerName: "Arjun Kumar",
            sellerCompletedSales: 1,
            categoryName: "Books",
            flaggedTerms: ["restricted term"],
          },
        ],
      }),
    });
  });
  await page.goto("/marketplace/admin/listings/pending");

  await expect(
    page.getByRole("heading", { name: "Pending listing queue" }),
  ).toBeVisible();
  await expect(page.locator(".admin-pending-card")).toHaveCount(2);
  await expect(page.locator(".admin-pending-image")).toHaveCount(1);
  await expect(page.locator(".admin-queue-count")).toHaveText("2 pending listings");
  await expect(page.locator(".admin-flag-badge")).toHaveCount(1);
  await expect(page.locator(".admin-review-button")).toHaveCount(2);

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "pending queue must not overflow at " + width + "px").toBe(
      false,
    );
    await expect(page.locator(".admin-pending-card").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Review" }).first()).toBeVisible();
  }

  await page.getByLabel("Sort by").selectOption("newest");
  await expect(
    page.getByRole("button", { name: "Clear filters" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Sort by")).toHaveValue("oldest");
  await context.close();
});

test("reports dashboard filters real queue rows and stacks cleanly on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/reports", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            publicReference: "RPT-2026-001",
            reporterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            targetType: "LISTING",
            targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            reason: "SCAM",
            details: "Seller requested payment outside the marketplace.",
            status: "OPEN",
            createdAt: "2026-09-06T10:20:02.000Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            publicReference: "RPT-2026-002",
            reporterId: null,
            targetType: "USER",
            targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            reason: "HARASSMENT",
            details: null,
            status: "INVESTIGATING",
            createdAt: "2026-09-05T08:14:11.000Z",
          },
        ],
      }),
    });
  });
  await page.route(
    "**/api/listings/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            title: "Engineering calculator",
            location: "North campus",
            images: [
              {
                url: "/marketplace/avatars/avatar-01.webp",
              },
            ],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            displayName: "Aarav Mehta",
            avatarId: "avatar-03",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/admin/users/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            displayName: "Reported student",
            avatarId: "avatar-02",
            campus: "South campus",
          },
        }),
      });
    },
  );
  await page.goto("/marketplace/admin/reports");

  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.locator(".admin-report-metric")).toHaveCount(4);
  await expect(page.locator(".admin-report-row")).toHaveCount(2);
  await expect(page.getByText("Engineering calculator")).toBeVisible();
  await expect(page.getByText("Aarav Mehta")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Engineering calculator thumbnail" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Investigate", exact: true })).toHaveAttribute(
    "href",
    "/marketplace/admin/reports/11111111-1111-4111-8111-111111111111",
  );
  await expect(page.getByRole("link", { name: "View", exact: true })).toHaveAttribute(
    "href",
    "/marketplace/admin/reports/22222222-2222-4222-8222-222222222222",
  );

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "reports page must not overflow at " + width + "px").toBe(false);
    await expect(page.locator(".admin-report-row").first()).toBeVisible();
  }

  await page.getByLabel("Status").selectOption("INVESTIGATING");
  await expect(page.getByText("Reports (1)")).toBeVisible();
  await expect(page.getByText("Reported student")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Reports (2)")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("missing report");
  await expect(page.getByRole("heading", { name: "No reports found" })).toBeVisible();
  await expect(page.getByText("Try adjusting or clearing your filters.")).toBeVisible();
  await context.close();
});

test("grievance queue preserves case actions and remains usable across breakpoints", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  const firstCaseId = "11111111-1111-4111-8111-111111111111";

  await page.route("**/api/admin/grievances", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: firstCaseId,
            publicReference: "GRV-2026-001",
            category: "CHILD_SAFETY",
            priority: "URGENT",
            reason: "CSAM_CHILD_SAFETY",
            status: "OPEN",
            assignedTo: null,
            acknowledgeDueAt: "2026-09-06T10:45:00.000Z",
            actionDueAt: "2026-09-06T11:00:00.000Z",
            acknowledgedAt: null,
            appealedAt: null,
            createdAt: "2026-09-06T10:20:02.000Z",
            overdue: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            publicReference: "GRV-2026-002",
            category: "GENERAL",
            priority: "STANDARD",
            reason: "ACCOUNT_ACCESS",
            status: "INVESTIGATING",
            assignedTo: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            acknowledgeDueAt: null,
            actionDueAt: "2026-09-08T08:15:00.000Z",
            acknowledgedAt: "2026-09-05T08:30:00.000Z",
            appealedAt: null,
            createdAt: "2026-09-05T08:15:00.000Z",
            overdue: false,
          },
        ],
      }),
    });
  });
  await page.route(
    `**/api/admin/grievances/${firstCaseId}`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: firstCaseId,
            publicReference: "GRV-2026-001",
            reason: "CSAM_CHILD_SAFETY",
            details: "Immediate safeguarding review required.",
            targetUrl: "https://example.invalid/protected-target",
            events: [],
          },
        }),
      });
    },
  );

  await page.goto("/marketplace/admin/grievances");

  await expect(
    page.getByRole("heading", { name: "Grievances & safety" }),
  ).toBeVisible();
  await expect(page.locator(".admin-safety-metric")).toHaveCount(4);
  await expect(page.locator(".admin-safety-case")).toHaveCount(2);
  await expect(page.getByText("Private reporter").first()).toBeVisible();
  await expect(page.getByText(/^Overdue Sep/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Investigate", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "View", exact: true })).toBeVisible();

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "grievances page must not overflow at " + width + "px").toBe(
      false,
    );
    await expect(page.locator(".admin-safety-case").first()).toBeVisible();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Status").selectOption("INVESTIGATING");
  await expect(page.getByText("Cases (1)")).toBeVisible();
  await expect(page.getByText("Account access")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("child safety");
  await expect(page.getByText("Cases (1)")).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Grievance cases" })
      .getByText("Child safety", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("button", { name: "Investigate", exact: true })
    .click();
  await expect(
    page.getByText("Immediate safeguarding review required."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acknowledge & Assign to Me" }),
  ).toBeVisible();
  await context.close();
});

test("admin users filters real user data and stacks cleanly on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { totalUsers: 12, verifiedUsers: 9, activeUsers: 7, newUsers: 3 },
      }),
    });
  });
  await page.route("**/api/admin/users?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            displayName: "Zoya Mehta",
            avatarId: "avatar-04",
            email: "zoya.mehta@example.edu",
            phoneVerifiedAt: "2026-09-01T08:00:00.000Z",
            suspendedAt: null,
            completedSales: 3,
            createdAt: "2026-09-06T08:00:00.000Z",
            roles: ["USER", "SUPER_ADMIN"],
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            displayName: "Aarav Kumar",
            avatarId: "avatar-05",
            email: "aarav.kumar@example.edu",
            phoneVerifiedAt: null,
            suspendedAt: "2026-09-05T08:00:00.000Z",
            completedSales: 0,
            createdAt: "2026-09-05T08:00:00.000Z",
            roles: ["USER"],
          },
        ],
      }),
    });
  });
  await page.goto("/marketplace/admin/users");

  await expect(page.getByRole("heading", { level: 2, name: "Users" })).toBeVisible();
  await expect(page.locator(".admin-user-metric")).toHaveCount(4);
  await expect(page.locator(".admin-user-row")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Zoya Mehta's avatar" })).toBeVisible();
  await expect(page.getByText("75% of all users")).toBeVisible();
  await expect(page.locator('.admin-user-roles [data-role="SUPER_ADMIN"]')).toBeVisible();
  await expect(page.locator(".admin-user-row").first().locator(".admin-user-roles > span")).toHaveCount(1);
  await expect(page.locator(".admin-user-row").first().getByRole("link", { name: "View" })).toHaveAttribute(
    "href",
    "/marketplace/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );

  await page.getByLabel("Phone verification").selectOption("UNVERIFIED");
  await expect(page.getByText("Users (1)")).toBeVisible();
  await expect(page.getByText("Aarav Kumar")).toBeVisible();
  await expect(page.getByText("Zoya Mehta")).toBeHidden();
  await page.getByRole("button", { name: "Clear filters" }).click();

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-user-row").first()).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "users page must not overflow at " + width + "px").toBe(false);
  }

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".admin-user-table-head")).toBeHidden();
  await expect(page.locator(".admin-user-action").first()).toBeVisible();
  await context.close();
});

test("admin reviews preserve moderation actions and remain responsive", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/reviews", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            reviewerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            revieweeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            rating: 5,
            text: "Great quality and a smooth exchange.",
            tags: ["Accurate description", "Friendly seller"],
            hiddenAt: null,
            hiddenReason: null,
            deletedAt: null,
            createdAt: "2026-09-06T10:20:02.000Z",
            direction: "BUYER_TO_SELLER",
            listing: {
              id: "99999999-9999-4999-8999-999999999999",
              title: "Trek FX 3 Hybrid Bike",
              coverImageUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            },
            reviewer: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              displayName: "Aarav Mehta",
              avatarId: "avatar-02",
            },
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            transactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            reviewerId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            revieweeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            rating: 3,
            text: "Item was as described.",
            tags: [],
            hiddenAt: "2026-09-06T12:00:00.000Z",
            hiddenReason: "Moderated",
            deletedAt: null,
            createdAt: "2026-09-05T08:14:00.000Z",
            direction: "SELLER_TO_BUYER",
            listing: {
              id: "88888888-8888-4888-8888-888888888888",
              title: "Calculator",
              coverImageUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            },
            reviewer: {
              id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              displayName: "Sneha Kapoor",
              avatarId: "avatar-03",
            },
          },
        ],
      }),
    });
  });

  await page.goto("/marketplace/admin/reviews");
  await expect(page.getByRole("heading", { level: 2, name: "Reviews" })).toBeVisible();
  await expect(page.locator(".admin-review-metric")).toHaveCount(4);
  await expect(page.locator(".admin-review-row")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "5 out of 5 stars" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Trek FX 3 Hybrid Bike" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Aarav Mehta's avatar" })).toBeVisible();
  await expect(page.locator('.admin-review-status [data-status="VISIBLE"]')).toBeVisible();
  await expect(page.locator('.admin-review-status [data-status="HIDDEN"]')).toBeVisible();
  await expect(page.locator(".admin-review-direction").getByText("Buyer \u2192 Seller")).toBeVisible();
  await expect(page.locator(".admin-review-direction").getByText("Seller \u2192 Buyer")).toBeVisible();

  await page.getByLabel("Rating").selectOption("3");
  await expect(page.getByText("Reviews (1)")).toBeVisible();
  await expect(page.getByRole("table", { name: "Reviews" }).getByText("Sneha Kapoor")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Review type").selectOption("SELLER_TO_BUYER");
  await expect(page.getByText("Reviews (1)")).toBeVisible();
  await expect(page.getByRole("table", { name: "Reviews" }).getByText("Sneha Kapoor")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-review-row").first()).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "reviews page must not overflow at " + width + "px").toBe(false);
  }

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".admin-review-table-head")).toBeHidden();
  await expect(page.locator(".admin-review-action").first()).toBeVisible();
  await context.close();
});

test("admin support queue filters real tickets and stacks cleanly on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/support", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            category: "ACCOUNT",
            subject: "Unable to verify college email",
            description: "Verification is not completing.",
            status: "OPEN",
            assignedTo: null,
            referenceType: null,
            referenceId: null,
            escalatedReportId: null,
            resolvedAt: null,
            closedAt: null,
            createdAt: "2026-09-05T08:00:00.000Z",
            updatedAt: "2026-09-06T08:00:00.000Z",
            requester: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              displayName: "Shubhang Sharma",
              avatarId: "avatar-01",
            },
            assignee: null,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            category: "TRANSACTION",
            subject: "Payment confirmation not received",
            description: "The exchange confirmation is missing.",
            status: "WAITING_FOR_USER",
            assignedTo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            referenceType: "TRANSACTION",
            referenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            escalatedReportId: null,
            resolvedAt: null,
            closedAt: null,
            createdAt: "2026-09-04T08:00:00.000Z",
            updatedAt: "2026-09-06T09:00:00.000Z",
            requester: {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              displayName: "Sneha Kapoor",
              avatarId: "avatar-03",
            },
            assignee: {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              displayName: "Rohan Verma",
              avatarId: "avatar-05",
            },
          },
        ],
      }),
    });
  });

  await page.goto("/marketplace/admin/support");
  await expect(page.getByRole("heading", { level: 2, name: "Support" })).toBeVisible();
  await expect(page.locator(".admin-support-metric")).toHaveCount(4);
  await expect(page.locator(".admin-support-row")).toHaveCount(2);
  await expect(page.getByText("Shubhang Sharma")).toBeVisible();
  await expect(
    page.locator('.admin-support-row', { hasText: 'Shubhang Sharma' }).locator('[data-avatar-id="avatar-01"]'),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /open thread/i })).toHaveAttribute(
    "href",
    "/marketplace/admin/support/22222222-2222-4222-8222-222222222222",
  );

  await page.getByLabel("Status").selectOption("WAITING_FOR_USER");
  await expect(page.getByText("Support queue (1)")).toBeVisible();
  await expect(page.getByText("Payment confirmation not received")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-support-row").first()).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "support page must not overflow at " + width + "px").toBe(false);
  }

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".admin-support-table-head")).toBeHidden();
  await expect(page.locator(".admin-support-action").first()).toBeVisible();
  await context.close();
});

test("admin audit logs filter immutable records and stack cleanly on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/audit-logs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            adminId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            role: "SUPER_ADMIN",
            action: "VIEW_GRIEVANCE",
            targetType: "REPORT",
            targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            previousState: null,
            newState: null,
            internalReason: "Grievance investigation",
            userVisibleReason: null,
            requestId: "request-identifier-that-must-not-wrap-across-lines",
            ipHash: null,
            createdAt: "2026-09-06T10:20:02.000Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            adminId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            role: "MODERATOR",
            action: "LISTING_APPROVE",
            targetType: "LISTING",
            targetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            previousState: null,
            newState: { moderationState: "APPROVED" },
            internalReason: "Listing approved after review",
            userVisibleReason: null,
            requestId: "second-request-id",
            ipHash: null,
            createdAt: "2026-08-24T08:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/marketplace/admin/audit-logs");
  await expect(page.getByRole("heading", { level: 2, name: "Audit logs" })).toBeVisible();
  await expect(page.locator(".admin-audit-metric")).toHaveCount(4);
  await expect(page.locator(".admin-audit-row")).toHaveCount(2);
  await expect(
    page.getByTitle("request-identifier-that-must-not-wrap-across-lines"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /export logs/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^view/i })).toHaveCount(0);

  await page.getByLabel("Action").selectOption("LISTING_APPROVE");
  await expect(page.getByText("Audit log (1)")).toBeVisible();
  await expect(page.getByText("Listing approved after review")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-audit-row").first()).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "audit-log page must not overflow at " + width + "px").toBe(false);
  }

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".admin-audit-table-head")).toBeHidden();
  await expect(page.locator(".admin-audit-request").first()).toBeVisible();
  await context.close();
});

test("admin categories keep real actions and stack cleanly on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  await page.route("**/api/admin/categories", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: {} }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "category-1", name: "Books & notes", slug: "books-notes", active: true, sortOrder: 4 },
          { id: "category-2", name: "Room essentials", slug: "room-essentials", active: false, sortOrder: 8 },
        ],
      }),
    });
  });
  await page.route("**/api/admin/prohibited-terms", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: {} }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "term-1", term: "fake id", severity: "FLAG", active: true },
          { id: "term-2", term: "gift card", severity: "BLOCK", active: false },
        ],
      }),
    });
  });

  await page.goto("/marketplace/admin/categories");
  await expect(page.getByRole("heading", { level: 2, name: "Categories" })).toBeVisible();
  await expect(page.locator(".admin-category-metric")).toHaveCount(3);
  await expect(page.locator(".admin-category-row")).toHaveCount(2);
  await expect(page.locator(".admin-term-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Disable Books & notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable gift card" })).toBeVisible();
  await expect(page.getByRole("button", { name: /save order/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^edit/i })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = page.locator(".admin-sidebar");
  const initialSidebarBox = await sidebar.boundingBox();
  await page.evaluate(() => window.scrollTo(0, 20));
  const scrolledSidebarBox = await sidebar.boundingBox();
  expect(initialSidebarBox).not.toBeNull();
  expect(scrolledSidebarBox).not.toBeNull();
  expect(Math.abs(scrolledSidebarBox!.y - initialSidebarBox!.y)).toBeLessThanOrEqual(1);

  for (const width of [1440, 1280, 1024, 768, 480, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".admin-category-row").first()).toBeVisible();
    await expect(page.locator(".admin-term-row").first()).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, "categories page must not overflow at " + width + "px").toBe(false);
  }

  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator(".admin-category-table-head")).toBeHidden();
  await expect(page.locator(".admin-terms-table-head")).toBeHidden();
  await expect(page.locator(".admin-category-slug").first()).toBeVisible();
  await context.close();
});

test('admin listing history filters removed and changes-requested listings and returns to the same view', async ({ browser }) => {
  const context = await browser.newContext();
  await signInAsAdmin(context);
  const page = await context.newPage();
  const listing = {
    id: '33333333-3333-4333-8333-333333333333', title: 'Calculator awaiting better photos',
    description: 'A scientific calculator with its original cover.', submittedAt: '2026-09-06T10:30:00.000Z',
    moderationState: 'REJECTED', lifecycleState: 'DRAFT', requestedChanges: 'Please upload a clear photo of the actual item.',
    condition: 'GOOD', priceLabel: '₹450', location: 'Campus', images: [],
  };
  await page.route('**/api/admin/listings?*', async route => {
    const removed = new URL(route.request().url()).searchParams.get('status') === 'REMOVED';
    await route.fulfill({ json: { data: { rows: [{ listing: removed ? { ...listing, moderationState: 'REMOVED', requestedChanges: null, rejectionReason: 'Removed after review' } : listing, sellerName: 'Priya Sharma', sellerCompletedSales: 2, categoryName: 'Electronics', coverImageUrl: null, flaggedTerms: [] }], total: 1, page: 1, pageSize: 50 } } });
  });
  await page.route('**/api/admin/listings/' + listing.id, route => route.fulfill({ json: { data: { listing, seller: { displayName: 'Priya Sharma', completedSales: 2 }, rejectionHistory: [] } } }));
  await page.route('**/api/listings/' + listing.id, route => route.fulfill({ json: { data: listing } }));
  await page.goto('/marketplace/admin/listings');
  await expect(page.getByRole('heading', { name: 'All listings', exact: true })).toBeVisible();
  await page.getByLabel('Moderation status').selectOption('REMOVED');
  await expect(page.locator('.status-removed')).toBeVisible();
  await expect(page.getByText('Removed after review')).toBeVisible();
  await page.getByLabel('Moderation status').selectOption('CHANGES_REQUESTED');
  await expect(page.locator('.status-changes-requested')).toBeVisible();
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'history must fit at ' + width).toBe(true);
    await expect(page.getByRole('link', { name: 'View listing' })).toBeVisible();
  }
  await page.getByRole('link', { name: 'View listing' }).click();
  await expect(page.getByRole('heading', { name: 'Requested changes', exact: true })).toBeVisible();
  await expect(page.getByText(listing.requestedChanges, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to listings' }).click();
  await expect(page.getByLabel('Moderation status')).toHaveValue('CHANGES_REQUESTED');
  await context.close();
});
