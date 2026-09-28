import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const listingImageSurfaces = [
  { name: "browse card", wrapperClass: "market-card-visual", imageClass: "market-card-image" },
  { name: "seller listing", wrapperClass: "my-listing-image" },
  { name: "public seller listing", wrapperClass: "seller-listing-visual", imageClass: "seller-listing-image" },
  { name: "upload preview", wrapperClass: "photo-preview" },
  { name: "search result", wrapperClass: "marketplace-search-result-image" },
  { name: "main gallery", wrapperClass: "product-gallery-main", imageClass: "product-gallery-main-image" },
  { name: "gallery thumbnail", wrapperClass: "product-gallery-thumbnail", imageClass: "product-gallery-thumbnail-image" },
  { name: "conversation preview", imageClass: "conversation-image" },
  { name: "chat header", imageClass: "chat-listing-image" },
  { name: "request card", wrapperClass: "request-product-thumbnail", imageClass: "request-product-image" },
  { name: "moderation image", imageClass: "product-image" },
] as const;

const imageDimensions = [
  { name: "landscape", width: 1600, height: 900 },
  { name: "portrait", width: 900, height: 1600 },
  { name: "square", width: 1000, height: 1000 },
  { name: "calculator phone photo", width: 1170, height: 2532 },
] as const;

test("listing images use the intended fit at every supported surface and aspect ratio", async ({ page }) => {
  const stylesheet = (await readFile("apps/web/src/styles.css", "utf8")).replace('@import "tailwindcss";', "");
  await page.setContent("<main></main>");
  await page.addStyleTag({ content: stylesheet });

  for (const surface of listingImageSurfaces) {
    for (const dimensions of imageDimensions) {
      const result = await page.evaluate(async ({ surface, dimensions }) => {
        const main = document.querySelector("main")!;
        const wrapper = document.createElement("div");
        wrapper.style.width = "320px";
        wrapper.style.height = "240px";
        if (surface.wrapperClass) wrapper.className = surface.wrapperClass;

        const image = document.createElement("img");
        if (surface.imageClass) image.className = surface.imageClass;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}"><rect width="100%" height="100%" fill="#101a14"/><rect x="1" y="1" width="${dimensions.width - 2}" height="${dimensions.height - 2}" fill="none" stroke="#ff00ff" stroke-width="2"/></svg>`;
        image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        wrapper.append(image);
        main.replaceChildren(wrapper);
        await image.decode();

        const imageStyle = getComputedStyle(image);
        const imageBox = image.getBoundingClientRect();
        const wrapperBox = wrapper.getBoundingClientRect();
        return {
          objectFit: imageStyle.objectFit,
          objectPosition: imageStyle.objectPosition,
          overflows: imageBox.width > wrapperBox.width + 0.1 || imageBox.height > wrapperBox.height + 0.1,
        };
      }, { surface, dimensions });

      expect(result, `${surface.name}: ${dimensions.name}`).toEqual({
        objectFit: surface.name === "browse card" ? "cover" : "contain",
        objectPosition: "50% 50%",
        overflows: false,
      });
    }
  }
});

test("request-card media stays compact and contained at supported mobile widths", async ({ page }) => {
  const stylesheet = (await readFile("apps/web/src/styles.css", "utf8")).replace('@import "tailwindcss";', "");
  const mobileWidths = [375, 390, 412, 430];

  for (const width of mobileWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`
      <main class="page transactions-page" style="--color-surface: #fffaf4; --color-surface-muted: #efe4d6; --color-line: #d8c9b8; --color-muted: #756b61">
        <div class="transaction-list section">
          <article class="panel transaction-card">
            <div class="transaction-card-header">
              <div class="transaction-card-main">
                <a class="request-product-thumbnail" href="#listing">
                  <img class="request-product-image" alt="Portrait listing" />
                </a>
                <div class="transaction-card-copy"><h2>Portrait listing</h2></div>
              </div>
            </div>
          </article>
        </div>
      </main>
    `);
    await page.addStyleTag({ content: stylesheet });
    await page.locator(".request-product-image").evaluate((image: HTMLImageElement) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="100%" height="100%" fill="#d8c9b8"/></svg>';
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      return image.decode();
    });

    const result = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".transaction-card")!;
      const main = document.querySelector<HTMLElement>(".transaction-card-main")!;
      const wrapper = document.querySelector<HTMLElement>(".request-product-thumbnail")!;
      const image = document.querySelector<HTMLImageElement>(".request-product-image")!;
      const copy = document.querySelector<HTMLElement>(".transaction-card-copy")!;
      const cardBox = card.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const wrapperBox = wrapper.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      const copyBox = copy.getBoundingClientRect();
      const imageStyle = getComputedStyle(image);
      const wrapperStyle = getComputedStyle(wrapper);

      return {
        ratio: wrapperBox.width / wrapperBox.height,
        fillsMain: Math.abs(wrapperBox.width - mainBox.width) < 0.5,
        containedByCard: wrapperBox.left >= cardBox.left && wrapperBox.right <= cardBox.right,
        imageOverflows: imageBox.width > wrapperBox.width + 0.1 || imageBox.height > wrapperBox.height + 0.1,
        contentGap: copyBox.top - wrapperBox.bottom,
        objectFit: imageStyle.objectFit,
        objectPosition: imageStyle.objectPosition,
        imageDisplay: imageStyle.display,
        background: wrapperStyle.backgroundColor,
      };
    });

    expect(result.ratio, `${width}px aspect ratio`).toBeCloseTo(4 / 3, 2);
    expect(result.fillsMain, `${width}px card width`).toBe(true);
    expect(result.containedByCard, `${width}px card containment`).toBe(true);
    expect(result.imageOverflows, `${width}px image overflow`).toBe(false);
    expect(result.contentGap, `${width}px content gap`).toBeGreaterThanOrEqual(0);
    expect(result.contentGap, `${width}px content gap`).toBeLessThanOrEqual(16);
    expect(result.objectFit).toBe("contain");
    expect(result.objectPosition).toBe("50% 50%");
    expect(result.imageDisplay).toBe("block");
    expect(result.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(result.background).not.toBe("rgb(0, 0, 0)");
  }
});
