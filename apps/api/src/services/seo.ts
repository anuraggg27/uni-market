import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { idSchema, knownMarketplacePath, marketplaceHeroDescription, marketplaceHeroTitle, publicSeoPages, seoPath, staticPageSeo, type SeoMetadata } from '@campus-market/shared';
import type { Database } from '../db/client.js';
import { listingImages, listings, users } from '../db/schema.js';

// SEO must never publish a draft or bypass image moderation/account removal.
const visibleListing = and(
  eq(listings.moderationState, 'APPROVED'), inArray(listings.lifecycleState, ['ACTIVE', 'RESERVED', 'SOLD']),
  isNull(listings.deletedAt),
  sql`exists (select 1 from ${users} where ${users.id} = ${listings.sellerId} and ${users.deletedAt} is null and ${users.closedAt} is null and ${users.suspendedAt} is null)`,
  sql`not exists (select 1 from ${listingImages} where ${listingImages.listingId} = ${listings.id} and ${listingImages.deletedAt} is null and ${listingImages.syntheticStatus} <> 'NOT_SYNTHETIC')`,
);
export const searchableListing = and(visibleListing, inArray(listings.lifecycleState, ['ACTIVE', 'RESERVED']));

export const seoListingFields = {
  id: listings.id, title: listings.title, description: listings.description,
  priceType: listings.priceType, exactPrice: listings.exactPrice,
  minimumPrice: listings.minimumPrice, maximumPrice: listings.maximumPrice,
  location: listings.location, condition: listings.condition, updatedAt: listings.updatedAt,
  lifecycleState: listings.lifecycleState,
};
type PublicListing = { id: string; title: string; description: string; priceType: string; exactPrice: number | null; minimumPrice: number | null; maximumPrice: number | null; location: string; condition: string };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function listingPrice(item: PublicListing): string {
  if (item.priceType === 'FREE') return 'Free';
  const format = (value: number | null) => `₹${(value ?? 0).toLocaleString('en-IN')}`;
  return item.priceType === 'RANGE' ? `${format(item.minimumPrice)}–${format(item.maximumPrice)}` : format(item.exactPrice);
}

function listingLinks(rows: PublicListing[]): string {
  return rows.length ? `<ul>${rows.map((item) => `<li><a href="/marketplace/listing/${item.id}">${escapeHtml(item.title)}</a> — ${escapeHtml(listingPrice(item))} · ${escapeHtml(item.location)}</li>`).join('')}</ul>` : '<p>No listings are available right now. Check back soon.</p>';
}

export interface SeoPage { metadata: SeoMetadata; content: string; status: number }

export async function getSeoPage(db: Database, origin: string, pathname: string, search = ''): Promise<SeoPage> {
  const path = seoPath(pathname);
  const metadata = staticPageSeo(origin, path, search);
  if (path === '/' || path === '/browse') {
    const params = new URLSearchParams(search);
    const page = /^\d{1,6}$/.test(params.get('page') ?? '') ? Math.max(1, Number(params.get('page'))) : 1;
    // Filtered/search pages are noindex and remain interactive; do not serve
    // unrelated unfiltered listings in their initial HTML.
    const filtered = path === '/browse' && metadata.robots.startsWith('noindex');
    const rows = filtered ? [] : await db.select(seoListingFields).from(listings).where(searchableListing).orderBy(desc(listings.approvedAt), desc(listings.id)).limit(25).offset(path === '/' ? 0 : (page - 1) * 24);
    const title = path === '/' ? marketplaceHeroTitle : 'Browse products';
    const description = path === '/' ? marketplaceHeroDescription : metadata.description;
    const content = `<h1>${title}</h1><p>${escapeHtml(description)}</p>${filtered ? '<p>Enable JavaScript to search and filter products.</p>' : listingLinks(rows.slice(0, 24))}${rows.length > 24 && path === '/browse' ? `<a href="/marketplace/browse?page=${page + 1}">Next page</a>` : ''}${page > 1 && path === '/browse' ? `<a href="/marketplace/browse${page > 2 ? `?page=${page - 1}` : ''}">Previous page</a>` : ''}`;
    if (path === '/browse' && page > 1 && !rows.length && !filtered) return { metadata: { ...metadata, robots: 'noindex, follow' }, content: '<h1>Page not found</h1>', status: 404 };
    return { metadata, content, status: 200 };
  }
  const listingMatch = /^\/listing\/([^/]+)$/.exec(path);
  if (listingMatch && idSchema.safeParse(listingMatch[1]).success) {
    const id = listingMatch[1]!;
    const [item] = await db.select(seoListingFields).from(listings).where(and(visibleListing, eq(listings.id, id))).limit(1);
    if (item) {
      const [image] = await db.select({ id: listingImages.id }).from(listingImages).where(and(eq(listingImages.listingId, id), isNull(listingImages.deletedAt), sql`${listingImages.objectKey} is not null`, sql`${listingImages.finalizedAt} is not null`)).orderBy(asc(listingImages.position)).limit(1);
      const price = listingPrice(item);
      return {
        metadata: { ...metadata, title: `${item.title} | Uni Marketplace`, description: `${price} · ${item.location}. ${item.description}`.replace(/\s+/g, ' ').slice(0, 160), robots: item.lifecycleState === 'SOLD' ? 'noindex, follow' : 'index, follow, max-image-preview:large', ...(image && item.lifecycleState !== 'SOLD' ? { image: new URL(`/media/listings/${id}/${image.id}`, origin).href, imageAlt: item.title } : {}) },
        content: `<h1>${escapeHtml(item.title)}</h1><p>${item.lifecycleState === 'SOLD' ? 'Sold · ' : item.lifecycleState === 'RESERVED' ? 'Reserved · ' : ''}${escapeHtml(price)} · ${escapeHtml(item.location)} · ${escapeHtml(item.condition.replaceAll('_', ' ').toLowerCase())}</p><p>${escapeHtml(item.description)}</p><p><a href="/marketplace/login">Sign in to contact the seller</a></p>`,
        status: 200,
      };
    }
  }
  if (listingMatch || !knownMarketplacePath(path)) return { metadata: { ...metadata, title: listingMatch ? 'Listing | Uni Market' : 'Page Not Found | Uni Market', description: 'This page or listing is unavailable.', robots: 'noindex, follow' }, content: '<h1>Page not found</h1><p>This page or listing is unavailable.</p>', status: 404 };
  const page = publicSeoPages[path];
  return { metadata, content: `<h1>${escapeHtml((page?.title ?? metadata.title).split(' | ')[0]!)}</h1><p>${escapeHtml(metadata.description)}</p><p>Enable JavaScript to use this page.</p>`, status: 200 };
}

export function renderSeoHtml(template: string, page: SeoPage, path: string, origin: string): string {
  const { metadata } = page;
  const meta = (name: string, content: string, property = false) => `<meta ${property ? 'property' : 'name'}="${name}" content="${escapeHtml(content)}" data-seo>`;
  // Query strings can contain private tracking tokens; metadata never needs them.
  const serialized = JSON.stringify({ path: path.split('?')[0], metadata }).replace(/</g, '\\u003c');
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: metadata.title, description: metadata.description, url: metadata.canonical, isPartOf: { '@type': 'WebSite', name: 'Uni Market', alternateName: 'Uni Marketplace', url: new URL('/marketplace', origin).href } }).replace(/</g, '\\u003c');
  const head = [
    `<title data-seo>${escapeHtml(metadata.title)}</title>`, meta('description', metadata.description), meta('robots', metadata.robots),
    `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" data-seo>`, meta('seo-origin', origin),
    meta('og:site_name', 'Uni Market', true), meta('og:type', 'website', true), meta('og:locale', 'en_IN', true),
    meta('og:title', metadata.title, true), meta('og:description', metadata.description, true), meta('og:url', metadata.canonical, true),
    meta('twitter:card', metadata.image ? 'summary_large_image' : 'summary'),
    meta('twitter:title', metadata.title), meta('twitter:description', metadata.description),
    ...(metadata.image ? [meta('og:image', metadata.image, true), meta('og:image:alt', metadata.imageAlt ?? metadata.title, true), meta('twitter:image', metadata.image)] : []),
    `<script type="application/json" id="seo-data">${serialized}</script>`,
    ...(metadata.robots.startsWith('index') ? [`<script type="application/ld+json" data-seo>${structured}</script>`] : []),
  ].join('\n');
  const body = `<div id="root"><div class="page"><nav aria-label="Marketplace"><a href="/marketplace">Uni Market</a> · <a href="/marketplace/browse">Browse</a> · <a href="/marketplace/sell">Sell</a></nav><main>${page.content}</main><footer><a href="/marketplace/terms">Terms</a> · <a href="/marketplace/privacy">Privacy</a></footer></div></div>`;
  return template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '').replace(/<meta\b[^>]*name=["'](?:description|robots)["'][^>]*>/gi, '').replace('</head>', () => `${head}\n</head>`).replace('<div id="root"></div>', () => body);
}
