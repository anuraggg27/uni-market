import { expect, test } from '@playwright/test';

test('SEO metadata follows public, private and missing routes without duplicates', async ({ page }) => {
  await page.goto('/marketplace/');
  await expect(page).toHaveTitle('Uni Marketplace | Buy & Sell Used Items with Students');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/marketplace$/);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^index/);
  await page.locator('.site-footer').getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveTitle('Browse Used Student Essentials | Uni Marketplace');
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
