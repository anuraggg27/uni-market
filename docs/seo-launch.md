# Search visibility checklist

## Implemented

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
4. Inspect `https://uni.rocks/marketplace` and one approved active listing. Run
   Test live URL, confirm rendered content and canonical, then request indexing.
5. Check Page indexing for unexpected exclusions and Performance for impressions,
   clicks and queries such as “uni marketplace”. These reports, not a site: search,
   are the source of truth about Google's processing of this property.

Useful follow-up work: fully hydrated React SSR if measurements justify it,
helpful campus-specific public content, real listings, and genuine links from
student clubs/communities. Avoid mass-generated pages, keyword stuffing or paid
link schemes. Crawling/indexing and search positions are not guaranteed.

References:
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
