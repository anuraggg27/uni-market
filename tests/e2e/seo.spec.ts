import { expect, test } from '@playwright/test';

test('SEO metadata follows public, private and missing routes without duplicates', async ({ page }) => {
  await page.goto('/marketplace/');
  await expect(page).toHaveTitle('Uni Rocks Marketplace | Buy & Sell Used Student Essentials');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/marketplace$/);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^index/);
  await page.locator('.site-footer').getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveTitle('Browse Used Student Essentials | Uni Marketplace');
  await expect(page.locator('.category-links')).toHaveCount(0);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/marketplace\/browse$/);
  await expect(page.locator('head title')).toHaveCount(1);
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  await page.goto('/marketplace/login');
  await expect(page).toHaveTitle('Sign In | Uni Market');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^noindex/);
  await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(0);
  await page.goto('/marketplace/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page Not Found | Uni Market');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^noindex/);
});

test('filtered browse pages do not publish search terms as canonical URLs', async ({ page }) => {
  await page.goto('/marketplace/browse?q=textbook&utm_source=test');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^noindex/);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/marketplace\/browse$/);
});

test('categories are linked, browse the selected category, and preserve metadata on navigation', async ({ page }) => {
  await page.goto('/marketplace/');
  await expect(page.locator('.category-links')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Browse by category', exact: true })).toBeVisible();
  expect((await page.getByRole('heading', { name: 'Browse by category', exact: true }).boundingBox())!.y)
    .toBeLessThan((await page.getByRole('heading', { name: 'Recently added', exact: true }).boundingBox())!.y);
  await page.getByRole('navigation', { name: 'Marketplace categories', exact: true }).getByRole('link', { name: 'Books', exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace\/category\/books$/);
  await expect(page.getByRole('heading', { name: 'Books', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByText('Books', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Books | Uni Rocks Marketplace');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/marketplace\/category\/books$/);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^index/);
  const schema = JSON.parse(await page.locator('head script[type="application/ld+json"]').textContent() ?? '{}');
  expect(schema['@graph']).toEqual(expect.arrayContaining([expect.objectContaining({ '@type': 'BreadcrumbList' })]));
  const desktopFilters = page.getByRole('form', { name: 'Product filters' }).filter({ visible: true });
  const selectedId = await desktopFilters.getByRole('combobox', { name: 'Category', exact: true }).inputValue();
  expect(selectedId).not.toBe('');
  await desktopFilters.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ label: 'Electronics' });
  await desktopFilters.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace\/category\/electronics$/);
  await expect(page).toHaveTitle('Electronics | Uni Rocks Marketplace');
  await expect(page.locator('.category-links')).toHaveCount(0);
  await page.goto('/marketplace/categories');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Marketplace Categories | Uni Rocks Marketplace');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});

test('mobile homepage uses compact category shortcuts and horizontally scrollable product rails', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/listings?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: Array.from({ length: 4 }, (_, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index}`,
          title: `Mobile listing ${index + 1}`,
          categoryName: 'Books',
          condition: 'GOOD',
          location: 'Campus',
          priceType: 'FIXED',
          exactPrice: 500 + index,
          lifecycleState: 'ACTIVE',
          createdAt: new Date().toISOString(),
        })),
      }),
    });
  });
  await page.goto('/marketplace/');

  const categorySection = page.locator('.home-category-section');
  const visibleCategoryCards = categorySection.locator('.home-category-card:visible');
  await expect(visibleCategoryCards).toHaveCount(5);
  expect(await visibleCategoryCards.locator('strong').allTextContents()).toEqual(['Books', 'Electronics', 'Furniture', 'Cycles', 'All categories']);
  await expect(visibleCategoryCards.last()).toHaveAttribute('href', '/marketplace/categories');
  await expect(visibleCategoryCards.last()).toContainText('All categories');
  expect(await categorySection.locator('.home-category-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  await expect(categorySection.locator('.home-category-copy > span').first()).toBeHidden();

  const recentlyAdded = page.getByRole('heading', { name: 'Recently added', exact: true });
  const categoryHeading = page.getByRole('heading', { name: 'Browse by category', exact: true });
  expect((await categoryHeading.boundingBox())!.y).toBeLessThan((await recentlyAdded.boundingBox())!.y);

  const rail = page.locator('.home-product-section .product-grid').first();
  await expect(rail).toHaveCSS('display', 'flex');
  await expect(rail).toHaveCSS('overflow-x', 'auto');
  for (const width of [375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await categorySection.locator('.home-category-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const visibleCardRatio = await rail.evaluate((element) => {
      const card = element.querySelector<HTMLElement>('.market-card');
      return card ? element.clientWidth / card.getBoundingClientRect().width : 0;
    });
    expect(visibleCardRatio).toBeGreaterThan(1.55);
    expect(visibleCardRatio).toBeLessThan(2.1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test('the shared Uni Rocks favicon is a publicly readable square PNG with an ICO fallback', async ({ page, request }) => {
  await page.goto('/marketplace/');
  const icon = page.locator('head link[rel="icon"][sizes="96x96"]');
  const href = await icon.getAttribute('href');
  expect(href).toBeTruthy();
  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/png');
  const png = await response.body();
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(96);
  expect(png.readUInt32BE(20)).toBe(96);
  const icoHref = await page.locator('head link[rel="icon"][type="image/x-icon"]').getAttribute('href');
  const ico = await request.get(icoHref!);
  expect(ico.ok()).toBe(true);
  expect((await ico.body()).readUInt16LE(2)).toBe(1);
});
