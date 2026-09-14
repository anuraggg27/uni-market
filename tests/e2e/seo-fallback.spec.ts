import { devices, expect, test } from "@playwright/test";
import { renderSeoHtml } from "../../apps/api/src/services/seo";
import { staticPageSeo } from "../../packages/shared/src/seo";

const template = '<!doctype html><html lang="en"><head><meta name="description" content="old"><meta name="robots" content="noindex"><title>Old</title></head><body><div id="root"></div></body></html>';
const content = [
  '<h1>Find what you need around campus</h1>',
  '<p>Buy and sell useful student essentials with people around campus.</p>',
  '<nav class="seo-category-links" aria-label="Marketplace categories"><ul><li><a href="/marketplace/category/books">Books</a></li><li><a href="/marketplace/category/electronics">Electronics</a></li></ul></nav>',
  '<ul class="seo-listing-grid"><li><a href="/marketplace/listing/example">Scientific calculator</a> — ₹450 · Campus</li></ul>',
].join("");

function fallbackDocument() {
  return renderSeoHtml(
    template,
    { metadata: staticPageSeo("https://uni.rocks", "/"), content, status: 200 },
    "/",
    "https://uni.rocks",
  );
}

test("crawlable pre-React content is a styled, responsive marketplace shell", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.setContent(fallbackDocument());

    const result = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".seo-fallback-header")!;
      const heading = document.querySelector<HTMLElement>(".seo-fallback-main > h1")!;
      const categories = document.querySelector<HTMLElement>(".seo-category-links")!;
      const categoryList = categories.querySelector<HTMLElement>("ul")!;
      return {
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        headerHeight: header.getBoundingClientRect().height,
        headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
        headingAlign: getComputedStyle(heading).textAlign,
        categoryTop: categories.getBoundingClientRect().top,
        categoryDisplay: getComputedStyle(categoryList).display,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(result.bodyBackground).toBe("rgb(248, 242, 234)");
    expect(result.headerHeight).toBe(viewport.width <= 760 ? 64 : 72);
    expect(result.headingSize).toBeGreaterThanOrEqual(38);
    expect(result.headingAlign).toBe("center");
    expect(result.categoryTop).toBeGreaterThan(viewport.height * 0.7);
    expect(result.categoryDisplay).toBe("grid");
    expect(result.horizontalOverflow).toBe(false);
    await expect(page.getByRole("link", { name: "Books" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Scientific calculator" })).toBeVisible();
    await expect(page.locator("noscript, [hidden]")).toHaveCount(0);
  }
});

test("the critical shell honors the theme selected before React starts", async ({ page }) => {
  await page.setContent(fallbackDocument().replace('<html lang="en">', '<html class="dark" lang="en">'));

  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 18, 17)");
  await expect(page.locator(".seo-fallback-header")).toHaveCSS("background-color", "rgba(23, 25, 24, 0.96)");
});

test("the production HTML response stays styled when CSS and JavaScript are unavailable", async ({ page }) => {
  const apiPort = Number(process.env.E2E_API_PORT ?? "4000");
  const marketplaceUrl = `http://127.0.0.1:${apiPort}/marketplace`;
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (/\.(?:css|js)$/.test(pathname)) await route.abort();
    else await route.continue();
  });

  for (const navigation of [
    { width: 1280, referer: undefined },
    { width: 390, referer: "https://www.google.com/search?q=uni+market" },
  ]) {
    await page.setViewportSize({ width: navigation.width, height: 844 });
    const response = await page.goto(marketplaceUrl, {
      waitUntil: "domcontentloaded",
      referer: navigation.referer,
    });

    expect(response?.status()).toBe(200);
    await expect(page.locator("#root > .seo-fallback")).toBeVisible();
    await expect(page.locator(".seo-fallback-header")).toHaveCSS("height", navigation.width <= 760 ? "64px" : "72px");
    await expect(page.locator(".seo-fallback-main > h1")).toHaveCSS("text-align", "center");
    await expect(page.getByRole("navigation", { name: "Marketplace categories" })).toBeVisible();
    await expect(page.locator(".seo-category-links > ul")).toHaveCSS("display", "grid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#root > .seo-fallback")).toBeVisible();
    await expect(page.locator(".seo-fallback-header")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
});

test("the pre-React production response is polished in Android Chrome emulation", async ({ browser }) => {
  const apiPort = Number(process.env.E2E_API_PORT ?? "4000");
  const context = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (/\.(?:css|js)$/.test(pathname)) await route.abort();
    else await route.continue();
  });

  await page.goto(`http://127.0.0.1:${apiPort}/marketplace`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root > .seo-fallback")).toBeVisible();
  await expect(page.locator(".seo-fallback-header")).toHaveCSS("height", "64px");
  await expect(page.locator(".seo-category-links > ul")).toHaveCSS("grid-template-columns", /.+ .+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await context.close();
});
