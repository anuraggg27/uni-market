import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { categoryDescription, categoryPageSeo, categoryPath, idSchema, knownMarketplacePath, marketplaceHeroDescription, marketplaceHeroTitle, publicSeoPages, seoPath, seoStructuredData, staticPageSeo, type SeoMetadata } from '@campus-market/shared';
import type { Database } from '../db/client.js';
import { categories, listingImages, listings, users } from '../db/schema.js';

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

// The production server places crawlable content in #root until React starts.
// Keep this CSS inline so that document is presentable before either the large
// application stylesheet or JavaScript bundle has arrived.
const SEO_FALLBACK_STYLES = `<style id="seo-fallback-styles" data-seo>
html,body{min-height:100%;margin:0;background:#f8f2ea;color:#101211;font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}.seo-fallback{min-height:100vh;background:#f8f2ea;color:#101211}.seo-fallback a{color:inherit;text-decoration:none}
.seo-fallback-header{height:72px;border-bottom:1px solid #d8c8b3;background:rgba(255,250,244,.96)}
.seo-fallback-header-inner{width:min(1280px,100%);height:100%;display:flex;align-items:center;justify-content:space-between;gap:32px;margin:auto;padding:0 28px}
.seo-fallback-brand{font-size:19px;font-weight:800;letter-spacing:-.035em}.seo-fallback-nav{display:flex;align-items:center;gap:28px;color:#6b6255;font-size:14px;font-weight:600}
.seo-fallback-main{width:min(1180px,100%);min-height:calc(100vh - 72px);margin:auto;padding:1px 28px 72px}
.seo-fallback-main>h1{max-width:920px;margin:clamp(128px,24vh,230px) auto 18px;text-align:center;font-size:clamp(42px,6vw,76px);font-weight:650;letter-spacing:-.055em;line-height:1.02}
.seo-fallback-main>p{max-width:720px;margin:0 auto 16px;color:#6b6255;text-align:center;font-size:clamp(16px,1.8vw,20px);line-height:1.6}
.seo-category-links{margin-top:clamp(190px,27vh,290px)}.seo-category-links ul,.seo-listing-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0;padding:0;list-style:none}
.seo-category-links li,.seo-listing-grid li{min-width:0;border:1px solid #d8c8b3;border-radius:15px;background:#fffaf4;box-shadow:0 4px 18px rgba(72,37,47,.045)}
.seo-category-links li a{min-height:72px;display:flex;align-items:center;padding:18px;font-weight:700}.seo-category-links li p{margin:-10px 18px 18px;color:#6b6255;font-size:13px;line-height:1.45}
.seo-listing-grid{margin-top:44px}.seo-category-links+.seo-listing-grid{margin-top:44px}.seo-listing-grid li{min-height:104px;padding:18px;color:#6b6255;font-size:13px;line-height:1.55}.seo-listing-grid li a{display:block;margin-bottom:10px;color:#101211;font-size:15px;font-weight:750;line-height:1.35}
.seo-fallback-footer{border-top:1px solid #d8c8b3;background:#fffaf4}.seo-fallback-footer-inner{width:min(1180px,100%);display:flex;align-items:center;justify-content:space-between;gap:24px;margin:auto;padding:28px;color:#6b6255;font-size:13px}.seo-fallback-footer nav{display:flex;gap:20px}
html.dark,html.dark body{background:#101211;color:#f5eadb}html.dark .seo-fallback{background:#101211;color:#f5eadb}html.dark .seo-fallback-header{border-color:#34302d;background:rgba(23,25,24,.96)}html.dark .seo-fallback-nav,html.dark .seo-fallback-main>p,html.dark .seo-category-links li p,html.dark .seo-listing-grid li,html.dark .seo-fallback-footer-inner{color:#b7aa9a}html.dark .seo-category-links li,html.dark .seo-listing-grid li,html.dark .seo-fallback-footer{border-color:#34302d;background:#1b1d1c}html.dark .seo-listing-grid li a{color:#f5eadb}html.dark .seo-fallback-footer{background:#171918}
@media(max-width:760px){.seo-fallback-header{height:64px}.seo-fallback-header-inner{padding:0 18px}.seo-fallback-nav{gap:16px;font-size:12px}.seo-fallback-nav a:last-child{display:none}.seo-fallback-main{min-height:calc(100vh - 64px);padding:1px 18px 52px}.seo-fallback-main>h1{margin-top:clamp(108px,19vh,160px);font-size:clamp(38px,12vw,54px)}.seo-fallback-main>p{font-size:16px}.seo-category-links{margin-top:clamp(150px,24vh,220px)}.seo-category-links ul,.seo-listing-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.seo-category-links li a{min-height:64px;padding:14px}.seo-listing-grid li{padding:14px}.seo-fallback-footer-inner{align-items:flex-start;flex-direction:column;padding:24px 18px}}
@media(max-width:420px){.seo-fallback-nav{gap:12px}.seo-fallback-nav a:nth-child(2){display:none}.seo-listing-grid{grid-template-columns:1fr}}
</style>`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function listingPrice(item: PublicListing): string {
  if (item.priceType === 'FREE') return 'Free';
  const format = (value: number | null) => `₹${(value ?? 0).toLocaleString('en-IN')}`;
  return item.priceType === 'RANGE' ? `${format(item.minimumPrice)}–${format(item.maximumPrice)}` : format(item.exactPrice);
}

function listingLinks(rows: PublicListing[]): string {
  return rows.length ? `<ul class="seo-listing-grid">${rows.map((item) => `<li><a href="/marketplace/listing/${item.id}">${escapeHtml(item.title)}</a> — ${escapeHtml(listingPrice(item))} · ${escapeHtml(item.location)}</li>`).join('')}</ul>` : '<p>No listings are available right now. Check back soon.</p>';
}

export interface SeoPage { metadata: SeoMetadata; content: string; status: number }

export function publicCategories(db: Database) {
  return db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sortOrder), asc(categories.name));
}

function categoryLinks(rows: Array<{ name: string; slug: string }>, descriptions = false): string {
  return `<nav class="seo-category-links" aria-label="Marketplace categories"><ul>${rows.map((category) => `<li><a href="/marketplace${categoryPath(category.slug)}">${escapeHtml(category.name)}</a>${descriptions ? `<p>${escapeHtml(categoryDescription(category))}</p>` : ''}</li>`).join('')}</ul></nav>`;
}

export async function getSeoPage(db: Database, origin: string, pathname: string, search = ''): Promise<SeoPage> {
  const path = seoPath(pathname);
  let metadata = staticPageSeo(origin, path, search);
  const categoryMatch = /^\/category\/([a-z0-9-]+)$/.exec(path);
  const categoryRowsQuery = path === '/' || path === '/browse' || path === '/categories' || categoryMatch ? publicCategories(db) : Promise.resolve([]);
  const categoryRows = categoryMatch ? await categoryRowsQuery : [];
  const category = categoryMatch ? categoryRows.find((item) => item.slug === categoryMatch[1]) : undefined;
  if (categoryMatch && !category) return { metadata, content: '<h1>Category not found</h1>', status: 404 };
  if (category) metadata = categoryPageSeo(origin, category, search);
  if (path === '/categories') return { metadata, content: `<h1>Categories</h1><p>${escapeHtml(metadata.description)}</p>${categoryLinks(await categoryRowsQuery, true)}`, status: 200 };
  if (path === '/' || path === '/browse' || category) {
    const params = new URLSearchParams(search);
    const page = /^\d{1,6}$/.test(params.get('page') ?? '') ? Math.max(1, Number(params.get('page'))) : 1;
    // Filtered/search pages are noindex and remain interactive; do not serve
    // unrelated unfiltered listings in their initial HTML.
    const filtered = path !== '/' && metadata.robots.startsWith('noindex');
    const [rows, navigationCategories] = await Promise.all([
      filtered ? [] : db.select(seoListingFields).from(listings).where(and(searchableListing, category ? eq(listings.categoryId, category.id) : undefined)).orderBy(desc(listings.approvedAt), desc(listings.id)).limit(25).offset(path === '/' ? 0 : (page - 1) * 24),
      category ? categoryRows : categoryRowsQuery,
    ]);
    const title = path === '/' ? marketplaceHeroTitle : category?.name ?? 'Browse products';
    const description = path === '/' ? marketplaceHeroDescription : metadata.description;
    const content = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${categoryLinks(navigationCategories)}${filtered ? '<p>Enable JavaScript to search and filter products.</p>' : listingLinks(rows.slice(0, 24))}${rows.length > 24 && path !== '/' ? `<a href="/marketplace${path}?page=${page + 1}">Next page</a>` : ''}${page > 1 && path !== '/' ? `<a href="/marketplace${path}${page > 2 ? `?page=${page - 1}` : ''}">Previous page</a>` : ''}`;
    if (path !== '/' && page > 1 && !rows.length && !filtered) return { metadata: { ...metadata, robots: 'noindex, follow' }, content: '<h1>Page not found</h1>', status: 404 };
    return { metadata, content, status: 200 };
  }
  const listingMatch = /^\/listing\/([^/]+)$/.exec(path);
  if (listingMatch && idSchema.safeParse(listingMatch[1]).success) {
    const id = listingMatch[1]!;
    const [item] = await db.select({ ...seoListingFields, categoryName: categories.name, categorySlug: categories.slug }).from(listings).innerJoin(categories, eq(categories.id, listings.categoryId)).where(and(visibleListing, eq(listings.id, id))).limit(1);
    if (item) {
      const [image] = await db.select({ id: listingImages.id }).from(listingImages).where(and(eq(listingImages.listingId, id), isNull(listingImages.deletedAt), sql`${listingImages.objectKey} is not null`, sql`${listingImages.finalizedAt} is not null`)).orderBy(asc(listingImages.position)).limit(1);
      const price = listingPrice(item);
      return {
        metadata: { ...metadata, title: `${item.title} | Uni Rocks Marketplace`, description: `${price} · ${item.location}. ${item.description}`.replace(/\s+/g, ' ').slice(0, 160), breadcrumbs: [...metadata.breadcrumbs!, { name: item.categoryName, url: new URL(`/marketplace${categoryPath(item.categorySlug)}`, origin).href }, { name: item.title, url: metadata.canonical }], robots: item.lifecycleState === 'SOLD' ? 'noindex, follow' : 'index, follow, max-image-preview:large', ...(image && item.lifecycleState !== 'SOLD' ? { image: new URL(`/media/listings/${id}/${image.id}`, origin).href, imageAlt: item.title } : {}) },
        content: `<nav aria-label="Breadcrumb"><a href="/marketplace">Marketplace</a> · <a href="/marketplace${categoryPath(item.categorySlug)}">${escapeHtml(item.categoryName)}</a></nav><h1>${escapeHtml(item.title)}</h1><p>${item.lifecycleState === 'SOLD' ? 'Sold · ' : item.lifecycleState === 'RESERVED' ? 'Reserved · ' : ''}${escapeHtml(price)} · ${escapeHtml(item.location)} · ${escapeHtml(item.condition.replaceAll('_', ' ').toLowerCase())}</p><p>${escapeHtml(item.description)}</p><p><a href="/marketplace/login">Sign in to contact the seller</a></p>`,
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
  const structured = JSON.stringify(seoStructuredData(metadata)).replace(/</g, '\\u003c');
  const head = [
    SEO_FALLBACK_STYLES,
    `<title data-seo>${escapeHtml(metadata.title)}</title>`, meta('description', metadata.description), meta('robots', metadata.robots),
    `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" data-seo>`, meta('seo-origin', origin),
    meta('og:site_name', 'Uni Rocks', true), meta('og:type', 'website', true), meta('og:locale', 'en_IN', true),
    meta('og:title', metadata.title, true), meta('og:description', metadata.description, true), meta('og:url', metadata.canonical, true),
    meta('twitter:card', metadata.image ? 'summary_large_image' : 'summary'),
    meta('twitter:title', metadata.title), meta('twitter:description', metadata.description),
    ...(metadata.image ? [meta('og:image', metadata.image, true), meta('og:image:alt', metadata.imageAlt ?? metadata.title, true), meta('twitter:image', metadata.image)] : []),
    `<script type="application/json" id="seo-data">${serialized}</script>`,
    ...(metadata.robots.startsWith('index') ? [`<script type="application/ld+json" data-seo>${structured}</script>`] : []),
  ].join('\n');
  const body = `<div id="root"><div class="seo-fallback"><header class="seo-fallback-header"><div class="seo-fallback-header-inner"><a class="seo-fallback-brand" href="/marketplace">Uni Market</a><nav class="seo-fallback-nav" aria-label="Marketplace"><a href="/marketplace/browse">Browse</a><a href="/marketplace/categories">Categories</a><a href="/marketplace/sell">Sell</a></nav></div></header><main class="seo-fallback-main">${page.content}</main><footer class="seo-fallback-footer"><div class="seo-fallback-footer-inner"><strong>Uni Market</strong><nav aria-label="Legal"><a href="/marketplace/terms">Terms</a><a href="/marketplace/privacy">Privacy</a></nav></div></footer></div></div>`;
  return template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '').replace(/<meta\b[^>]*name=["'](?:description|robots)["'][^>]*>/gi, '').replace('</head>', () => `${head}\n</head>`).replace('<div id="root"></div>', () => body);
}
