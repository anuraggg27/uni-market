export const marketplaceSeoTitle = 'Uni Rocks Marketplace | Buy & Sell Used Student Essentials';
export const marketplaceSeoDescription = 'Buy and sell used books, electronics, furniture, cycles and room essentials with students on Uni Rocks Marketplace. Browse locally and chat with sellers.';
export const marketplaceHeroTitle = 'Find what you need around campus';
export const marketplaceHeroDescription = 'Uni Rocks Marketplace connects students buying and selling used books, tech, cycles and room essentials.';

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  image?: string;
  imageAlt?: string;
  breadcrumbs?: Array<{ name: string; url: string }>;
}

export const publicSeoPages: Record<string, { title: string; description: string }> = {
  '/': { title: marketplaceSeoTitle, description: marketplaceSeoDescription },
  '/browse': { title: 'Browse Used Student Essentials | Uni Marketplace', description: 'Browse second-hand books, electronics, furniture, cycles and room essentials listed by students on Uni Market.' },
  '/categories': { title: 'Marketplace Categories | Uni Rocks Marketplace', description: 'Explore used books, electronics, furniture, cycles, clothing, sports gear and room essentials on Uni Rocks Marketplace.' },
  '/terms': { title: 'Terms of Use | Uni Market', description: 'Read the terms for using Uni Market, including student eligibility, marketplace responsibilities and acceptable use.' },
  '/privacy': { title: 'Privacy Notice | Uni Market', description: 'Learn how Uni Market uses, protects and retains personal information, and how to exercise your privacy choices.' },
  '/seller-policy': { title: 'Seller Policy | Uni Market', description: 'Read the rules for selling used physical items on Uni Market, including accurate descriptions and genuine product photos.' },
  '/community-rules': { title: 'Community Rules | Uni Market', description: 'Read the community rules for respectful communication, honest listings and responsible use of Uni Market.' },
  '/prohibited-items': { title: 'Prohibited Items | Uni Market', description: 'Check which goods and content are prohibited before creating a listing on Uni Market.' },
  '/marketplace-disclosure': { title: 'About the Marketplace | Uni Market', description: 'Understand how Uni Market works as an independent student marketplace and the responsibilities of buyers and sellers.' },
};

const privateTitles: Record<string, string> = {
  login: 'Sign In', onboarding: 'Complete Your Profile', sell: 'Submit a Listing',
  'my-listings': 'My Listings', saved: 'Saved Items', chats: 'Chats', requests: 'Reservation Requests',
  transactions: 'Exchanges', profile: 'Your Profile', notifications: 'Notifications', support: 'Support',
  settings: 'Settings', admin: 'Administration', grievance: 'Report a Grievance',
  seller: 'Seller Profile', leaderboard: 'Top Sellers', listing: 'Listing',
};

export function seoPath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

export function staticPageSeo(origin: string, pathname: string, search = ''): SeoMetadata {
  const path = seoPath(pathname);
  const page = publicSeoPages[path];
  const params = new URLSearchParams(search);
  const pageNumber = params.get('page');
  const collection = path === '/browse' || /^\/category\/[^/]+$/.test(path);
  const paginated = collection && pageNumber !== null && /^[1-9]\d{0,5}$/.test(pageNumber);
  const filtered = collection && [...params.keys()].some((key) => !['page', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'].includes(key));
  const canonical = new URL(`/marketplace${path === '/' ? '' : path}`, origin);
  if (paginated && Number(pageNumber) > 1) canonical.searchParams.set('page', String(Number(pageNumber)));
  return {
    title: page?.title ?? `${privateTitles[path.split('/')[1] ?? ''] ?? 'Page Not Found'} | Uni Market`,
    description: page?.description ?? 'Manage your account and marketplace activity on Uni Market.',
    canonical: canonical.href,
    robots: page && !filtered && !(collection && pageNumber !== null && !paginated)
      ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    breadcrumbs: [
      { name: 'Uni Rocks', url: new URL('/', origin).href },
      { name: 'Marketplace', url: new URL('/marketplace', origin).href },
      ...(path !== '/' && page ? [{ name: path === '/browse' ? 'Browse' : path === '/categories' ? 'Categories' : page.title.split(' | ')[0]!, url: canonical.href }] : []),
    ],
  };
}

export function categoryPath(slug: string): string {
  return `/category/${encodeURIComponent(slug)}`;
}

export function categoryDescription(category: { name: string; slug: string }): string {
  const examples: Record<string, string> = {
    books: 'textbooks and other second-hand books',
    'books-notes': 'textbooks and other second-hand books',
    electronics: 'phones, laptops, monitors and everyday electronics',
    furniture: 'desks, chairs, shelves and other furniture',
    cycles: 'cycles and cycling accessories',
    'cycles-transport': 'cycles and cycling accessories',
    clothing: 'clothing and accessories', sports: 'sports equipment and fitness gear',
    'room-essentials': 'lamps, storage and other room essentials',
  };
  return `Buy and sell used ${examples[category.slug] ?? category.name.toLowerCase()} with students on Uni Rocks Marketplace. Browse listings and chat with sellers near you.`;
}

export function categoryPageSeo(origin: string, category: { name: string; slug: string }, search = ''): SeoMetadata {
  const base = staticPageSeo(origin, '/browse', search);
  const canonical = new URL(`/marketplace${categoryPath(category.slug)}`, origin);
  canonical.search = new URL(base.canonical).search;
  return {
    ...base, title: `${category.name} | Uni Rocks Marketplace`, description: categoryDescription(category), canonical: canonical.href,
    breadcrumbs: [
      { name: 'Uni Rocks', url: new URL('/', origin).href },
      { name: 'Marketplace', url: new URL('/marketplace', origin).href },
      { name: 'Categories', url: new URL('/marketplace/categories', origin).href },
      { name: category.name, url: canonical.href },
    ],
  };
}

// One schema builder for initial HTML and client navigation, so React never
// replaces the crawlable breadcrumbs/site identity with different markup.
export function seoStructuredData(metadata: SeoMetadata) {
  const origin = new URL(metadata.canonical).origin;
  const siteId = `${origin}/#website`;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': siteId, name: 'Uni Rocks', alternateName: ['uni.rocks', 'Uni Market', 'Uni Rocks Marketplace', 'Uni Marketplace'], url: `${origin}/` },
    { '@type': 'WebPage', '@id': `${metadata.canonical}#webpage`, name: metadata.title, description: metadata.description, url: metadata.canonical, isPartOf: { '@id': siteId }, ...(metadata.breadcrumbs?.length ? { breadcrumb: { '@id': `${metadata.canonical}#breadcrumb` } } : {}) },
    ...(metadata.breadcrumbs?.length ? [{ '@type': 'BreadcrumbList', '@id': `${metadata.canonical}#breadcrumb`, itemListElement: metadata.breadcrumbs.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })) }] : []),
  ] };
}

export function knownMarketplacePath(pathname: string): boolean {
  const path = seoPath(pathname);
  if (publicSeoPages[path]) return true;
  if (/^\/(login|onboarding|sell|my-listings|saved|chats|requests|transactions|profile|notifications|support|settings|grievance|leaderboard)$/.test(path)) return true;
  return /^\/(listing\/[^/]+(?:\/edit)?|seller\/[^/]+|chats\/[^/]+|support\/[^/]+|grievance\/track|admin(?:\/.*)?)$/.test(path);
}
