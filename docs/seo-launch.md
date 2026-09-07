# Search visibility checklist

## Implemented

- The root and known pre-migration product URLs use permanent redirects to
  `/marketplace`; trailing slashes and old category-ID filters consolidate to
  the same canonical destinations. Private support/sign-in targets remain
  `noindex` so old search results can disappear after recrawling.
- The marketplace title explicitly names **Uni Rocks Marketplace**. Shared
  JSON-LD supplies the domain-level **Uni Rocks** site name, alternate names,
  and a breadcrumb trail through Marketplace and Categories. Client navigation
  preserves the same schema as the initial HTML. The root currently redirects
  to the marketplace; move domain-level identity metadata onto a real root
  homepage when the multi-product site launches.
- `/marketplace/categories` and `/marketplace/category/<slug>` expose active
  admin-managed categories through real links, readable HTML, unique metadata
  and sitemap entries. Category results use the existing listing visibility
  controls. Search and sort variations remain noindex; pagination is canonical.
- Uni Rocks and Marketplace share the supplied Uni Rocks hand-mark artwork,
  including a 96×96 PNG, a multi-size ICO, and a 180×180 Apple touch icon.
  Stable root icon aliases redirect to those same public assets rather than
  returning 404. No separate Marketplace logo or header image is introduced.
  The dark-background source is saved as `apps/web/public/brand/uni-rocks-logo.png`;
  the supplied alternative PNG had an opaque checkerboard, not transparency.
  Regenerate icons with `node apps/web/scripts/generate-favicons.mjs`.

- Production HTML includes route-specific titles, descriptions, canonical URLs,
  social metadata and readable content for the homepage, browse and public listings.
  The same initial HTML is sent to users and crawlers; React replaces it with the
  existing interactive app. This is a server-rendered fallback, not full React SSR.
- Public available listings appear in a paginated XML sitemap (1,000 per shard).
  The sitemap excludes drafts, sold/withdrawn/expired/deleted items, removed or
  rejected listings, prohibited-image listings and closed/suspended seller accounts.
- Public product preview URLs recheck visibility before issuing short-lived image
  URLs. The object-storage bucket stays private.
- Account, admin, chat, grievance tracking and seller profile pages are noindex.
  Seller profiles remain usable publicly but are not promoted for name searches.
  Search/filter variations are noindex; canonical URLs omit tracking parameters.
- Unknown pages return HTTP 404. Owners can still open private draft previews.
- No new environment variables, paid service, or Google credentials are required
  for these code changes. Canonical origin comes from CLIENT_URL, not request Host.

## After deployment (requires the site owner's Google account)

1. Open Google Search Console and add the Domain property `uni.rocks`.
2. Copy Google's verification TXT record into the domain's DNS settings. DNS
   verification happens outside the codebase; do not add credentials to this repo.
3. Submit `https://uni.rocks/sitemap.xml` under Sitemaps.
4. Inspect `https://uni.rocks/`, `https://uni.rocks/marketplace`,
   `https://uni.rocks/marketplace/categories`, an active category URL and one approved active listing. Run
   Test live URL, confirm rendered content and canonical, then request indexing.
   Also inspect the old `/support` result to verify its redirect and the target's
   `noindex`. Do not block that URL in robots.txt: Google must read the directive.
5. Check Page indexing for unexpected exclusions and Performance for impressions,
   clicks and queries such as “uni marketplace”. These reports, not a site: search,
   are the source of truth about Google's processing of this property.

Google selects result titles, visible URL paths, favicons and sitelinks. These
changes make the intended presentation eligible; they cannot force Facebook's
category sitelink layout, an exact rank for “uni rocks marketplace”, or an
immediate update. Favicon/site-name processing can take days to weeks after
recrawling. Do not purchase indexing services or submit private account URLs.

Useful follow-up work: fully hydrated React SSR if measurements justify it,
helpful campus-specific public content, real listings, and genuine links from
student clubs/communities. Avoid mass-generated pages, keyword stuffing or paid
link schemes. Crawling/indexing and search positions are not guaranteed.

References:
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- https://developers.google.com/search/docs/crawling-indexing/301-redirects
- https://developers.google.com/search/docs/appearance/sitelinks
- https://developers.google.com/search/docs/appearance/favicon-in-search
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
