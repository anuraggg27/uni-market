import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { login, makeRole, setup } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => { ctx = await setup(); });
afterEach(async () => { await ctx.client.close(); });

describe('first-party traffic analytics', () => {
  it('counts one browser and one page visit despite repeated reloads', async () => {
    const visitorA = '11111111-1111-4111-8111-111111111111';
    const visitorB = '22222222-2222-4222-8222-222222222222';
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Mozilla/5.0 (iPhone) Mobile').send({ path: '/marketplace/listing/53e1be8c-77fa-43b9-b03c-5cbc0a7a09c5', visitorId: visitorA, landing: true, referrerHost: 'www.google.com' }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Mozilla/5.0 (iPhone) Mobile').send({ path: '/marketplace/listing/53e1be8c-77fa-43b9-b03c-5cbc0a7a09c5', visitorId: visitorA, landing: true, referrerHost: 'www.google.com' }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Mozilla/5.0 (iPhone) Mobile').send({ path: '/browse?q=desk', visitorId: visitorA, landing: false }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Mozilla/5.0 (iPhone) Mobile').send({ path: '/browse?q=desk', visitorId: visitorA, landing: true }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Mozilla/5.0 (Macintosh) Chrome/152').send({ path: '/category/books', visitorId: visitorB, landing: true }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('dnt', '1').send({ path: '/', visitorId: '33333333-3333-4333-8333-333333333333', landing: true }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('sec-gpc', '1').send({ path: '/', visitorId: '55555555-5555-4555-8555-555555555555', landing: true }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').set('user-agent', 'Googlebot/2.1').send({ path: '/', visitorId: '66666666-6666-4666-8666-666666666666', landing: true }).expect(204);
    await request(ctx.app).post('/api/analytics/page-view').send({ path: '/admin/users', visitorId: '44444444-4444-4444-8444-444444444444', landing: true }).expect(204);

    const visitors = await ctx.db.select().from(schema.analyticsDailyVisitors);
    expect(visitors).toHaveLength(2);
    expect(visitors.map((row) => row.pageViews).sort()).toEqual([1, 2]);
    expect(JSON.stringify(visitors)).not.toContain(visitorA);
    expect(JSON.stringify(visitors)).not.toContain(visitorB);
    expect(await ctx.db.select().from(schema.analyticsDailyPageVisitors)).toHaveLength(3);
    expect(await ctx.db.select().from(schema.analyticsDailyPages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: '/listing/:id', views: 1 }),
      expect.objectContaining({ route: '/browse', views: 1 }),
      expect.objectContaining({ route: '/category/books', views: 1 }),
    ]));
    const referrers = await ctx.db.select().from(schema.analyticsDailyReferrers);
    expect(referrers).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'Organic search', visits: 1 }),
      expect.objectContaining({ source: 'Direct', visits: 1 }),
    ]));
  });

  it('returns range summaries, top routes, sources and devices only to staff', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
    await ctx.db.insert(schema.analyticsDailyVisitors).values([
      { day, visitorHash: 'day-hash-a', identityHash: 'identity-a', pageViews: 2, deviceType: 'mobile' },
      { day, visitorHash: 'day-hash-b', identityHash: 'identity-b', pageViews: 2, deviceType: 'desktop' },
      { day: yesterday, visitorHash: 'previous-hash-a', identityHash: 'identity-a', pageViews: 1, deviceType: 'mobile' },
      { day: yesterday, visitorHash: 'previous-hash-c', identityHash: 'identity-c', pageViews: 1, deviceType: 'mobile' },
    ]);
    await ctx.db.insert(schema.analyticsDailyPageVisitors).values([
      { day, route: '/browse', identityHash: 'identity-a' },
      { day, route: '/browse', identityHash: 'identity-b' },
      { day, route: '/listing/:id', identityHash: 'identity-b' },
      { day: yesterday, route: '/browse', identityHash: 'identity-a' },
      { day: yesterday, route: '/browse', identityHash: 'identity-c' },
    ]);
    await ctx.db.insert(schema.analyticsDailyReferrers).values([
      { day, source: 'Direct', visits: 1 },
      { day: yesterday, source: 'Direct', visits: 1 },
    ]);
    await request(ctx.app).get('/api/admin/analytics?range=90').expect(401);
    const admin = await login(ctx.app, 'analytics-admin');
    await makeRole(ctx.db, admin.user.id, 'SUPER_ADMIN');
    const response = await admin.agent.get('/api/admin/analytics?range=90').expect(200);
    expect(response.body.data.summary).toMatchObject({ uniqueVisitors: 3, averageDailyVisitors: 2, todayVisitors: 2, peakDailyVisitors: 2 });
    expect(response.body.data.series).toHaveLength(2);
    expect(response.body.data.from).toBe(yesterday);
    expect(response.body.data.topPages[0]).toEqual({ route: '/browse', visitors: 3 });
    expect(response.body.data.referrers[0]).toEqual({ source: 'Direct', visits: 2 });
    expect(response.body.data.devices).toEqual(expect.arrayContaining([
      { device: 'mobile', visitors: 2 },
      { device: 'desktop', visitors: 1 },
    ]));
    await admin.agent.get('/api/admin/analytics?range=invalid').expect(400);
    expect(await ctx.db.select().from(schema.analyticsDailyVisitors).where(eq(schema.analyticsDailyVisitors.day, day))).toHaveLength(2);
  });
});
