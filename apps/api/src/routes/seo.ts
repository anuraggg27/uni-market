import { Router } from 'express';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { idSchema, publicSeoPages } from '@campus-market/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { listingImages, listings } from '../db/schema.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { escapeHtml, getSeoPage, renderSeoHtml, searchableListing } from '../services/seo.js';
import type { StorageService } from '../services/storage.js';

const SITEMAP_PAGE_SIZE = 1000;

export function seoRouter(db: Database, config: AppConfig, storage: StorageService): Router {
  const router = Router();
  const origin = new URL(config.CLIENT_URL).origin;
  const absolute = (path: string) => escapeHtml(new URL(path, origin).href);
  router.get('/robots.txt', (_req, res) => {
    // Do not block account routes here: crawlers must be able to read noindex.
    res.type('text/plain').set('Cache-Control', 'public, max-age=300').send(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
  });
  router.get('/sitemap.xml', asyncRoute(async (_req, res) => {
    const [row] = await db.select({ total: count() }).from(listings).where(searchableListing);
    const pages = Math.ceil(Number(row?.total ?? 0) / SITEMAP_PAGE_SIZE);
    const paths = ['/sitemap-static.xml', ...Array.from({ length: pages }, (_, index) => `/sitemap-listings-${index + 1}.xml`)];
    res.type('application/xml').set('Cache-Control', 'public, max-age=60').send(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<sitemap><loc>${absolute(path)}</loc></sitemap>`).join('')}</sitemapindex>`);
  }));
  router.get('/sitemap-static.xml', (_req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=300').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(publicSeoPages).map((path) => `<url><loc>${absolute(`/marketplace${path === '/' ? '' : path}`)}</loc></url>`).join('')}</urlset>`);
  });
  router.get(/^\/sitemap-listings-([1-9]\d{0,4})\.xml$/, asyncRoute(async (req, res) => {
    const page = Number(req.params[0]);
    const rows = await db.select({ id: listings.id, updatedAt: listings.updatedAt }).from(listings).where(searchableListing).orderBy(asc(listings.id)).limit(SITEMAP_PAGE_SIZE).offset((page - 1) * SITEMAP_PAGE_SIZE);
    if (!rows.length && page > 1) throw new AppError(404, 'NOT_FOUND', 'Sitemap not found');
    res.type('application/xml').set('Cache-Control', 'public, max-age=60').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map((row) => `<url><loc>${absolute(`/marketplace/listing/${row.id}`)}</loc><lastmod>${row.updatedAt.toISOString()}</lastmod></url>`).join('')}</urlset>`);
  }));
  router.get('/api/seo', asyncRoute(async (req, res) => {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!/^\/listing\/[^/]+$/.test(path) || path.length > 100) throw new AppError(400, 'INVALID_SEO_PATH', 'Invalid page');
    const page = await getSeoPage(db, origin, path);
    // Metadata only, never private listing records or rendered HTML.
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').json({ data: page.metadata });
  }));
  // Stable preview URL: the bucket remains private and each read is rechecked.
  router.get('/media/listings/:listingId/:imageId', asyncRoute(async (req, res) => {
    if (!idSchema.safeParse(req.params.listingId).success || !idSchema.safeParse(req.params.imageId).success) throw new AppError(404, 'NOT_FOUND', 'Image unavailable');
    const [image] = await db.select({ key: listingImages.objectKey }).from(listingImages).innerJoin(listings, eq(listings.id, listingImages.listingId)).where(and(searchableListing, eq(listings.id, String(req.params.listingId)), eq(listingImages.id, String(req.params.imageId)), isNull(listingImages.deletedAt), sql`${listingImages.finalizedAt} is not null`)).limit(1);
    if (!image?.key) throw new AppError(404, 'NOT_FOUND', 'Image unavailable');
    res.set('Cache-Control', 'no-store').redirect(302, await storage.signedReadUrl(image.key));
  }));
  return router;
}

export function marketplaceHtmlRouter(db: Database, config: AppConfig, template: string): Router {
  const router = Router();
  const origin = new URL(config.CLIENT_URL).origin;
  const render = asyncRoute(async (req, res) => {
    const path = req.path.slice('/marketplace'.length) || '/';
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const page = await getSeoPage(db, origin, path, search);
    // Keep owner/moderator draft previews working without publishing their data.
    if (page.status === 404 && req.auth && /^\/listing\/[^/]+$/.test(path)) {
      const id = path.split('/')[2];
      if (idSchema.safeParse(id).success) {
        const [owner] = await db.select({ sellerId: listings.sellerId }).from(listings).where(and(eq(listings.id, id!), isNull(listings.deletedAt))).limit(1);
        if (owner && (owner.sellerId === req.auth.userId || req.auth.roles.some((role: string) => ['MODERATOR', 'SUPER_ADMIN'].includes(role)))) page.status = 200;
      }
    }
    res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', page.metadata.robots).status(page.status).type('html').send(renderSeoHtml(template, page, path + search, origin));
  });
  router.get('/marketplace', render);
  router.get('/marketplace/{*path}', render);
  return router;
}
