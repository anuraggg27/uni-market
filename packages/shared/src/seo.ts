export const marketplaceSeoTitle = 'Uni Marketplace | Buy & Sell Used Items with Students';
export const marketplaceSeoDescription = 'Buy and sell used textbooks, electronics, cycles and room essentials with students on Uni Market, an independent student marketplace.';
export const marketplaceHeroTitle = 'Find what you need around campus';
export const marketplaceHeroDescription = 'The student marketplace for peer-to-peer textbook, tech, cycle, and room essentials exchanges.';

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  image?: string;
  imageAlt?: string;
}

export const publicSeoPages: Record<string, { title: string; description: string }> = {
  '/': { title: marketplaceSeoTitle, description: marketplaceSeoDescription },
  '/browse': { title: 'Browse Used Student Essentials | Uni Marketplace', description: 'Browse second-hand books, electronics, furniture, cycles and room essentials listed by students on Uni Market.' },
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
  const paginated = path === '/browse' && pageNumber !== null && /^[1-9]\d{0,5}$/.test(pageNumber);
  const filtered = path === '/browse' && [...params.keys()].some((key) => !['page', 'utm_source', 'utm_medium', 'utm_campaign'].includes(key));
  const canonical = new URL(`/marketplace${path === '/' ? '' : path}`, origin);
  if (paginated && Number(pageNumber) > 1) canonical.searchParams.set('page', String(Number(pageNumber)));
  return {
    title: page?.title ?? `${privateTitles[path.split('/')[1] ?? ''] ?? 'Page Not Found'} | Uni Market`,
    description: page?.description ?? 'Manage your account and marketplace activity on Uni Market.',
    canonical: canonical.href,
    robots: page && !filtered && !(path === '/browse' && pageNumber !== null && !paginated)
      ? 'index, follow, max-image-preview:large' : 'noindex, follow',
  };
}

export function knownMarketplacePath(pathname: string): boolean {
  const path = seoPath(pathname);
  if (publicSeoPages[path]) return true;
  if (/^\/(login|onboarding|sell|my-listings|saved|chats|requests|transactions|profile|notifications|support|settings|grievance|leaderboard)$/.test(path)) return true;
  return /^\/(listing\/[^/]+(?:\/edit)?|seller\/[^/]+|chats\/[^/]+|support\/[^/]+|grievance\/track|admin(?:\/.*)?)$/.test(path);
}
