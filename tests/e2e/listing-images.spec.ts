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
  { name: "moderation image", imageClass: "product-image" },
] as const;

const imageDimensions = [
  { name: "landscape", width: 1600, height: 900 },
  { name: "portrait", width: 900, height: 1600 },
  { name: "square", width: 1000, height: 1000 },
  { name: "calculator phone photo", width: 1170, height: 2532 },
] as const;

test("listing images remain fully contained at every supported surface and aspect ratio", async ({ page }) => {
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
        objectFit: "contain",
        objectPosition: "50% 50%",
        overflows: false,
      });
    }
  }
});
