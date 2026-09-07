import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { categories, listings, listingImages, users } from '../../apps/api/src/db/schema';
import { login, setup } from './helper';

const template = '<!doctype html><html><head><title>Uni Market</title><meta name="description" content="old"><meta name="robots" content="noindex"></head><body><div id="root"></div><script src="/marketplace/app.js"></script></body></html>';
let ctx: Awaited<ReturnType<typeof setup>>;
let owner: Awaited<ReturnType<typeof login>>;
let activeId: string;
let draftId: string;
let imageId: string;
const excluded: string[] = [];

beforeAll(async () => {
  ctx = await setup({ webIndexHtml: template });
  owner = await login(ctx.app, 'seo-owner');
  for (const lifecycleState of ['ACTIVE', 'RESERVED', 'SOLD', 'DRAFT', 'WITHDRAWN', 'EXPIRED'] as const) {
    const [item] = await ctx.db.insert(listings).values({ sellerId: owner.user.id, categoryId: ctx.category.id, title: lifecycleState === 'DRAFT' ? 'PRIVATE DRAFT TITLE' : `Textbook ${lifecycleState}`, description: 'A used textbook with clean pages.', condition: 'GOOD', priceType: 'FIXED', exactPrice: 450, location: 'Campus', lifecycleState, moderationState: lifecycleState === 'DRAFT' ? 'PENDING' : 'APPROVED', approvedAt: new Date() }).returning();
    if (lifecycleState === 'ACTIVE') activeId = item!.id;
    else if (lifecycleState === 'DRAFT') draftId = item!.id;
    if (!['ACTIVE', 'RESERVED'].includes(lifecycleState)) excluded.push(item!.id);
  }
  const [image] = await ctx.db.insert(listingImages).values({ listingId: activeId, ownerId: owner.user.id, position: 0, objectKey: `listings/${activeId}/photo.webp`, mimeType: 'image/webp', byteSize: 100, syntheticStatus: 'NOT_SYNTHETIC', finalizedAt: new Date() }).returning();
  imageId = image!.id;
});
afterAll(async () => { await ctx?.client.close(); });

describe('production-style SEO routes', () => {
  it('permanently migrates root and legacy URLs without losing queries', async () => {
    const home = await request(ctx.app).get('/?utm_source=club').expect(301);
    expect(home.headers.location).toBe('/marketplace?utm_source=club');
    const support = await request(ctx.app).get('/support').expect(301);
    expect(support.headers.location).toBe('/marketplace/support');
    const destination = await request(ctx.app).get(support.headers.location).expect(200);
    expect(destination.headers['x-robots-tag']).toMatch(/^noindex/);
    expect(destination.text).not.toContain('Sign in to Uni Market');
    expect((await request(ctx.app).get('/marketplace/').expect(301)).headers.location).toBe('/marketplace');
    expect((await request(ctx.app).get('/marketplace/category/books/?page=2').expect(301)).headers.location).toBe('/marketplace/category/books?page=2');
    await request(ctx.app).get('/future-product').expect(404);
  });
  it('exposes stable root favicon aliases without redirecting to HTML', async () => {
    for (const [path, filename] of [['/favicon.ico', 'favicon.ico'], ['/favicon.png', 'favicon-96x96.png'], ['/apple-touch-icon.png', 'apple-touch-icon.png'], ['/favicon-96x96.png', 'favicon-96x96.png']]) {
      const response = await request(ctx.app).get(path).expect(301);
      expect(response.headers.location).toBe(`/marketplace/${filename}`);
    }
  });
  it('publishes active categories, their products, breadcrumbs and sitemap entries', async () => {
    const [inactive] = await ctx.db.insert(categories).values({ name: 'Hidden category', slug: 'hidden-category', active: false }).returning();
    const [electronics] = await ctx.db.insert(categories).values({ name: 'Electronics', slug: 'electronics' }).returning();
    await ctx.db.insert(listings).values({ sellerId: owner.user.id, categoryId: electronics!.id, title: 'Electronics-only monitor', description: 'A working used monitor for a student desk.', condition: 'GOOD', priceType: 'FIXED', exactPrice: 450, location: 'Campus', lifecycleState: 'ACTIVE', moderationState: 'APPROVED', approvedAt: new Date() });
    const directory = await request(ctx.app).get('/marketplace/categories').expect(200);
    expect(directory.text).toContain('href="/marketplace/category/books"');
    expect(directory.text).not.toContain(inactive!.slug);
    const page = await request(ctx.app).get('/marketplace/category/books').expect(200);
    expect(page.text).toContain('<h1>Books</h1>');
    expect(page.text).toContain(`/marketplace/listing/${activeId}`);
    expect(page.text).toContain('http://localhost:5173/marketplace/category/books');
    expect(page.text).toContain('"@type":"BreadcrumbList"');
    expect(page.text).not.toContain('PRIVATE DRAFT TITLE');
    expect(page.text).not.toContain('Electronics-only monitor');
    expect((await request(ctx.app).get('/marketplace/category/electronics')).text).toContain('Electronics-only monitor');
    expect(page.headers['x-robots-tag']).toMatch(/^index/);
    const metadata = await request(ctx.app).get('/api/seo?path=/category/books&search=%3Fq%3Dprivate').expect(200);
    expect(metadata.body.data.robots).toMatch(/^noindex/);
    expect(metadata.body.data.title).toBe('Books | Uni Rocks Marketplace');
    expect(JSON.stringify(metadata.body)).not.toContain('private');
    expect((await request(ctx.app).get('/sitemap-static.xml')).text).toContain('/marketplace/category/books');
    expect((await request(ctx.app).get('/sitemap-static.xml')).text).not.toContain(inactive!.slug);
    const redirect = await request(ctx.app).get(`/marketplace/browse?category=${ctx.category.id}&utm_source=club`).expect(301);
    expect(redirect.headers.location).toBe('/marketplace/category/books?utm_source=club');
    await request(ctx.app).get('/marketplace/category/hidden-category').expect(404);
    await request(ctx.app).get('/marketplace/category/missing').expect(404);
    await request(ctx.app).get('/marketplace/category/books?page=999').expect(404);
  });
  it('serves readable public HTML and correct canonicals without executing JavaScript', async () => {
    const home = await request(ctx.app).get('/marketplace?utm_source=club').set('Host', 'untrusted.example').expect(200);
    expect(home.text).toContain('Find what you need around campus');
    expect(home.text).toContain(`/marketplace/listing/${activeId}`);
    expect(home.text).toContain('href="http://localhost:5173/marketplace"');
    expect(home.text).not.toContain('untrusted.example');
    expect(home.text).not.toContain('PRIVATE DRAFT TITLE');
    expect(home.headers['x-robots-tag']).toMatch(/^index/);
    const listing = await request(ctx.app).get(`/marketplace/listing/${activeId}`).expect(200);
    expect(listing.text).toContain('<h1>Textbook ACTIVE</h1>');
    expect(listing.text).toContain('₹450');
    expect(listing.text).toContain(`/media/listings/${activeId}/${imageId}`);
    expect(listing.text).not.toContain(owner.user.email);
  });
  it('exposes a sitemap index and only eligible available listings', async () => {
    const robots = await request(ctx.app).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Sitemap: http://localhost:5173/sitemap.xml');
    const index = await request(ctx.app).get('/sitemap.xml').expect(200);
    expect(index.headers['content-type']).toContain('application/xml');
    expect(index.text).toContain('/sitemap-static.xml');
    expect(index.text).toContain('/sitemap-listings-1.xml');
    const sitemap = await request(ctx.app).get('/sitemap-listings-1.xml').expect(200);
    expect(sitemap.text).toContain(activeId);
    for (const id of excluded) expect(sitemap.text).not.toContain(id);
    expect(sitemap.text).toContain('<lastmod>');
    const staticMap = await request(ctx.app).get('/sitemap-static.xml').expect(200);
    expect(staticMap.text).not.toMatch(/\/settings|\/admin|\/profile|\/seller\//);
    await request(ctx.app).get('/sitemap-listings-999.xml').expect(404);
  });
  it('marks private pages and real missing pages noindex', async () => {
    for (const path of ['/settings', '/chats/secret', '/admin', '/seller/student', '/grievance/track']) {
      const page = await request(ctx.app).get(`/marketplace${path}`).expect(200);
      expect(page.headers['x-robots-tag']).toMatch(/^noindex/);
    }
    for (const path of ['/not-real', `/listing/${randomUUID()}`, '/listing/invalid']) {
      const page = await request(ctx.app).get(`/marketplace${path}`).expect(404);
      expect(page.headers['x-robots-tag']).toMatch(/^noindex/);
    }
    await request(ctx.app).get('/marketplace/browse?page=999').expect(404);
  });
  it('keeps owner draft previews working without leaking draft content', async () => {
    const guest = await request(ctx.app).get(`/marketplace/listing/${draftId}`).expect(404);
    const preview = await owner.agent.get(`/marketplace/listing/${draftId}`).expect(200);
    const metadata = await owner.agent.get(`/api/seo?path=/listing/${draftId}`).expect(200);
    for (const response of [guest, preview, metadata]) expect(response.text).not.toContain('PRIVATE DRAFT TITLE');
    expect(preview.headers['x-robots-tag']).toMatch(/^noindex/);
    expect(metadata.body.data.robots).toMatch(/^noindex/);
  });
  it('keeps sold listings accessible but stops advertising them to search engines', async () => {
    const [sold] = await ctx.db.select({ id: listings.id }).from(listings).where(eq(listings.lifecycleState, 'SOLD'));
    const page = await request(ctx.app).get(`/marketplace/listing/${sold!.id}`).expect(200);
    expect(page.headers['x-robots-tag']).toMatch(/^noindex/);
    expect(page.text).toContain('Sold ·');
  });
  it('does not echo private query tokens into metadata or the HTML bootstrap', async () => {
    const page = await request(ctx.app).get('/marketplace/grievance/track?token=secret-tracking-token').expect(200);
    expect(page.text).not.toContain('secret-tracking-token');
    expect(page.headers['cache-control']).toBe('private, no-store');
  });
  it('provides stable public image previews but never draft images', async () => {
    const image = await request(ctx.app).get(`/media/listings/${activeId}/${imageId}`).expect(302);
    expect(image.headers.location).toContain('/api/uploads/local-read?');
    expect(image.headers['cache-control']).toBe('no-store');
    await request(ctx.app).get(`/media/listings/${draftId}/${imageId}`).expect(404);
    await request(ctx.app).get('/media/listings/invalid/invalid').expect(404);
  });
  it('removes newly moderated, deleted and synthetic content from all discovery routes', async () => {
    const mutations = [
      { moderationState: 'REMOVED' as const },
      { moderationState: 'REJECTED' as const },
      { deletedAt: new Date() },
    ];
    for (const mutation of mutations) {
      await ctx.db.update(listings).set(mutation).where(eq(listings.id, activeId));
      await request(ctx.app).get(`/marketplace/listing/${activeId}`).expect(404);
      expect((await request(ctx.app).get('/sitemap-listings-1.xml')).text).not.toContain(activeId);
      await request(ctx.app).get(`/media/listings/${activeId}/${imageId}`).expect(404);
      await ctx.db.update(listings).set({ moderationState: 'APPROVED', deletedAt: null }).where(eq(listings.id, activeId));
    }
    await ctx.db.update(listingImages).set({ syntheticStatus: 'UNKNOWN' }).where(eq(listingImages.id, imageId));
    await request(ctx.app).get(`/marketplace/listing/${activeId}`).expect(404);
    expect((await request(ctx.app).get('/sitemap-listings-1.xml')).text).not.toContain(activeId);
    await request(ctx.app).get(`/media/listings/${activeId}/${imageId}`).expect(404);
    await ctx.db.update(listingImages).set({ syntheticStatus: 'NOT_SYNTHETIC' }).where(eq(listingImages.id, imageId));
    await ctx.db.update(users).set({ closedAt: new Date() }).where(eq(users.id, owner.user.id));
    await request(ctx.app).get(`/marketplace/listing/${activeId}`).expect(404);
    expect((await request(ctx.app).get('/sitemap-listings-1.xml')).text).not.toContain(activeId);
    await ctx.db.update(users).set({ closedAt: null }).where(eq(users.id, owner.user.id));
  });
});
