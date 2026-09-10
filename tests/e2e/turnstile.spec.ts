import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`CAPTCHA stays open after a provider error and retries the request only with a fresh token at ${width}px`, async ({ page }) => {
    test.skip(!process.env.VITE_TURNSTILE_SITE_KEY, 'Run with a Cloudflare test site key configured for the Vite server');
    await page.setViewportSize({ width, height: 740 });
    let requests = 0;
    await page.route('**/api/auth/csrf', (route) => route.fulfill({ json: { data: { csrfToken: 'test-csrf' } } }));
    await page.route('**/api/turnstile-regression', async (route) => {
      requests++;
      if (requests === 1) {
        expect(route.request().headers()['x-turnstile-token']).toBeUndefined();
        await route.fulfill({ status: 403, json: { error: { code: 'BOT_CHECK_REQUIRED' } } });
      } else {
        expect(route.request().headers()['x-turnstile-token']).toBe('fresh-test-token');
        await route.fulfill({ json: { data: { ok: true } } });
      }
    });
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `let options;
        const apiScript = document.currentScript;
        const sdkOnload = new URL(apiScript.src).searchParams.get('onload');
        window.turnstile = {
          ready(callback) {
            if (apiScript.async || apiScript.defer) throw new Error('[Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready().');
            callback();
          },
          render(container, config) {
            options = config;
            const frame = document.createElement('div');
            frame.textContent = 'Test security challenge';
            frame.style.width = config.size === 'compact' ? '150px' : '300px';
            frame.style.height = config.size === 'compact' ? '140px' : '65px';
            container.append(frame);
            setTimeout(() => options['error-callback']('200500'), 20);
            return 'test-widget';
          },
          reset() { setTimeout(() => options.callback('fresh-test-token'), 20); },
          remove() {}
        };
        if (sdkOnload) setTimeout(() => window[sdkOnload](), 10);`,
    }));
    await page.goto('/marketplace/');
    await page.evaluate(() => {
      const modulePath = '/marketplace/src/api.ts';
      void import(modulePath).then(({ api }) => api('/api/turnstile-regression', { method: 'POST' }))
        .then(() => { document.body.dataset.challengeResult = 'success'; })
        .catch((error: Error) => { document.body.dataset.challengeResult = error.message; });
    });
    const dialog = page.getByRole('dialog', { name: 'One quick security check' });
    await expect(dialog.getByRole('status')).toContainText('Reference: 200500');
    await expect(dialog).toBeVisible();
    expect(requests).toBe(1);
    const panel = await page.locator('.security-dialog').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-challenge-result', 'success');
    await expect(dialog).toHaveCount(0);
    expect(requests).toBe(2);
  });
}
