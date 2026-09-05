import { describe, expect, it } from 'vitest';
import { knownMarketplacePath, staticPageSeo } from '../../packages/shared/src/seo';
import { renderSeoHtml } from '../../apps/api/src/services/seo';

describe('SEO metadata and safe HTML', () => {
  it('uses product-root canonicals and removes tracking parameters', () => {
    expect(staticPageSeo('https://uni.rocks', '/', '?utm_source=club').canonical).toBe('https://uni.rocks/marketplace');
    expect(staticPageSeo('https://uni.rocks', '/browse/', '?page=2&utm_source=club').canonical).toBe('https://uni.rocks/marketplace/browse?page=2');
    expect(staticPageSeo('https://uni.rocks', '/browse', '?page=2').robots).toMatch(/^index/);
    expect(staticPageSeo('https://uni.rocks', '/browse', '?q=textbooks').robots).toMatch(/^noindex/);
    expect(staticPageSeo('https://uni.rocks', '/browse', '?page=0').robots).toMatch(/^noindex/);
  });
  it.each(['/settings', '/chats/secret', '/admin/users', '/grievance/track', '/profile', '/seller/student', '/listing/draft', '/no-such-page'])('does not index %s', (path) => {
    expect(staticPageSeo('https://uni.rocks', path).robots).toMatch(/^noindex/);
  });
  it('distinguishes valid app routes from missing pages', () => {
    expect(knownMarketplacePath('/privacy')).toBe(true);
    expect(knownMarketplacePath('/listing/id/edit')).toBe(true);
    expect(knownMarketplacePath('/missing')).toBe(false);
  });
  it('escapes untrusted values and emits a single metadata set', () => {
    const metadata = { ...staticPageSeo('https://uni.rocks', '/'), title: '</title><script>alert(1)</script>', description: '" onload="alert(1) & $& </script>' };
    const html = renderSeoHtml('<html><head><title>Old</title><meta name="description" content="old"><meta name="robots" content="noindex"></head><body><div id="root"></div></body></html>', { metadata, status: 200, content: '<h1>Readable content</h1>' }, '/', 'https://uni.rocks');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('<h1>Readable content</h1>');
    expect(html.match(/<title\b/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/name="robots"/g)).toHaveLength(1);
    expect(html).toContain('$&');
  });
});
