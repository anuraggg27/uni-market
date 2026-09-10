import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLogs, categories } from '../../apps/api/src/db/schema';
import { login, makeRole, setup } from './helper';

describe('category administration', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin: Awaited<ReturnType<typeof login>>;

  beforeEach(async () => {
    ctx = await setup();
    admin = await login(ctx.app, 'category-admin');
    await makeRole(ctx.db, admin.user.id, 'SUPER_ADMIN');
  });
  afterEach(async () => { await ctx.client.close(); });

  it('returns a useful conflict for duplicate names or slugs without changing the existing category', async () => {
    const input = { name: 'Accessories', slug: 'accessories', sortOrder: 0 };
    const created = await admin.agent.post('/api/admin/categories').set(admin.headers).send(input).expect(201);
    for (const duplicate of [
      { ...input, sortOrder: 8 },
      { ...input, slug: 'new-accessories' },
      { ...input, name: 'Other accessories' },
    ]) {
      const response = await admin.agent.post('/api/admin/categories').set(admin.headers).send(duplicate).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'CATEGORY_EXISTS',
        message: 'A category with this name or slug already exists. Use the existing category instead.',
      });
    }
    const [saved] = await ctx.db.select().from(categories).where(eq(categories.id, created.body.data.id));
    expect(saved).toMatchObject(input);
    const audit = await ctx.db.select().from(adminAuditLogs).where(eq(adminAuditLogs.action, 'CATEGORY_CREATE'));
    expect(audit).toHaveLength(1);
  });

  it('keeps categories with shared sort numbers visible in the same alphabetical order in public and admin lists', async () => {
    const created = await admin.agent.post('/api/admin/categories').set(admin.headers)
      .send({ name: 'Accessories', slug: 'accessories', sortOrder: 0 }).expect(201);
    const publicResponse = await request(ctx.app).get('/api/categories').expect(200);
    const adminResponse = await admin.agent.get('/api/admin/categories').expect(200);
    expect(publicResponse.body.data.map((category: { name: string }) => category.name)).toEqual(['Accessories', 'Books']);
    expect(adminResponse.body.data.map((category: { name: string }) => category.name)).toEqual(['Accessories', 'Books']);
    expect(publicResponse.headers['cache-control']).toBe('public, no-cache');

    await admin.agent.patch(`/api/admin/categories/${created.body.data.id}`).set(admin.headers).send({ active: false }).expect(200);
    const updated = await request(ctx.app).get('/api/categories').set('If-None-Match', publicResponse.headers.etag).expect(200);
    expect(updated.body.data.map((category: { name: string }) => category.name)).toEqual(['Books']);
  });
});
