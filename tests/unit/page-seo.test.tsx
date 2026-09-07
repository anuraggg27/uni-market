// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { categoryPageSeo, staticPageSeo } from '../../packages/shared/src/seo';
import { applyPageSeo } from '../../apps/web/src/components/PageSeo';

afterEach(() => { document.head.replaceChildren(); });

it('replaces public metadata when navigating to an account page and back', () => {
  applyPageSeo({ ...staticPageSeo('https://uni.rocks', '/'), image: 'https://uni.rocks/media/listings/item/photo' });
  expect(document.querySelector('meta[property="og:image"]')).not.toBeNull();
  expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  applyPageSeo(staticPageSeo('https://uni.rocks', '/settings', '?token=private'));
  expect(document.title).toBe('Settings | Uni Market');
  expect(document.querySelector('meta[property="og:image"]')).toBeNull();
  expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
  expect(document.head.innerHTML).not.toContain('token=private');
  applyPageSeo(staticPageSeo('https://uni.rocks', '/browse'));
  expect(document.querySelectorAll('title')).toHaveLength(1);
  expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/^index/);
  applyPageSeo(categoryPageSeo('https://uni.rocks', { name: 'Books', slug: 'books' }));
  const structured = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
  expect(structured['@graph']).toEqual(expect.arrayContaining([expect.objectContaining({ '@type': 'BreadcrumbList' })]));
  expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe('Uni Rocks');
});
