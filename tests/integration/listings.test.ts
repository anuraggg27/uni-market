import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { createDraft, login, makeRole, setup, uploadImage, verifyPhone } from './helper';

let ctx:Awaited<ReturnType<typeof setup>>;let seller:Awaited<ReturnType<typeof login>>;
beforeEach(async()=>{ctx=await setup();seller=await login(ctx.app,'listing-seller');await verifyPhone(seller);});afterEach(async()=>ctx?.client.close());

async function draftWithImage(){const listing=await createDraft(seller,ctx.category.id);await uploadImage(seller,listing.id).then((r)=>expect(r.status).toBe(200));return listing;}
async function moderator(){const mod=await login(ctx.app,'listing-moderator');await makeRole(ctx.db,mod.user.id,'MODERATOR');return mod;}
async function approve(id:string){const mod=await moderator();return mod.agent.post(`/api/admin/listings/${id}/decision`).set(mod.headers).send({decision:'APPROVE'});}
const editPayload = (categoryId: string, overrides: Record<string, unknown> = {}) => ({
  title: 'Updated algebra textbook', description: 'Updated product details with enough information for a buyer.',
  categoryId, condition: 'GOOD', conditionExplanation: '', priceType: 'FIXED', exactPrice: 400,
  negotiable: true, location: 'Main campus', brand: '', defects: '', meetupPoint: '',
  ownershipAttested: true, usedPhysicalGoodsAttested: true, accurateDescriptionAttested: true, sellerPolicyAccepted: true,
  ...overrides,
});

describe('listing and moderation acceptance',()=>{
  it('exposes later browse pages and reports hasMore only when another item exists', async () => {
    await ctx.db.insert(schema.listings).values(Array.from({ length: 25 }, (_, index) => ({
      sellerId: seller.user.id, categoryId: ctx.category.id, title: `Browse item ${index + 1}`,
      description: 'A real used item with enough detail to browse.', condition: 'GOOD' as const,
      priceType: 'FIXED' as const, exactPrice: 100 + index, location: 'Main campus',
      moderationState: 'APPROVED' as const, lifecycleState: 'ACTIVE' as const, approvedAt: new Date(),
    })));
    const first = await request(ctx.app).get('/api/listings').expect(200);
    const second = await request(ctx.app).get('/api/listings?page=2').expect(200);
    expect(first.body.data).toHaveLength(24);
    expect(first.body.meta).toMatchObject({ page: 1, hasMore: true });
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta).toMatchObject({ page: 2, hasMore: false });
    expect(new Set([...first.body.data, ...second.body.data].map((row: { id: string }) => row.id)).size).toBe(25);
  });

  it('does not include free items above a positive minimum price', async () => {
    await ctx.db.insert(schema.listings).values([
      { sellerId: seller.user.id, categoryId: ctx.category.id, title: 'Free book', description: 'A free used student book.', condition: 'GOOD', priceType: 'FREE', location: 'Main campus', moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date() },
      { sellerId: seller.user.id, categoryId: ctx.category.id, title: 'Cheap book', description: 'An inexpensive used student book.', condition: 'GOOD', priceType: 'FIXED', exactPrice: 100, location: 'Main campus', moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date() },
      { sellerId: seller.user.id, categoryId: ctx.category.id, title: 'Priced book', description: 'A used student book for five hundred.', condition: 'GOOD', priceType: 'FIXED', exactPrice: 500, location: 'Main campus', moderationState: 'APPROVED', lifecycleState: 'ACTIVE', approvedAt: new Date() },
    ]);
    const filtered = await request(ctx.app).get('/api/listings?minPrice=500').expect(200);
    expect(filtered.body.data.map((row: { title: string }) => row.title)).toEqual(['Priced book']);
    const fromZero = await request(ctx.app).get('/api/listings?minPrice=0').expect(200);
    expect(fromZero.body.data.map((row: { title: string }) => row.title)).toContain('Free book');
  });

  it('returns a signed cover image URL in the pending moderation queue', async () => {
    const listing = await draftWithImage();
    await seller.agent
      .post(`/api/listings/${listing.id}/submit`)
      .set(seller.headers)
      .expect(200);
    const mod = await moderator();
    const queue = await mod.agent
      .get('/api/admin/listings/pending')
      .expect(200);
    expect(queue.body.data[0].listing.id).toBe(listing.id);
    expect(queue.body.data[0].coverImageUrl).toContain(
      '/api/uploads/local-read?key=',
    );
  });

  it.each([
    ['exactPrice', 'FIXED', -1], ['exactPrice', 'FIXED', 0],
    ['minimumPrice', 'RANGE', -1], ['minimumPrice', 'RANGE', 0],
    ['maximumPrice', 'RANGE', -1], ['maximumPrice', 'RANGE', 0],
  ] as const)('rejects %s of %s %s on creation and editing', async (field, priceType, value) => {
    const listing = await createDraft(seller, ctx.category.id);
    const input = { ...listing, conditionExplanation: '', brand: '', defects: '', meetupPoint: '', priceType, exactPrice: priceType === 'FIXED' ? 50 : null, minimumPrice: priceType === 'RANGE' ? 10 : null, maximumPrice: priceType === 'RANGE' ? 50 : null, [field]: value, ownershipAttested: true, usedPhysicalGoodsAttested: true, accurateDescriptionAttested: true, sellerPolicyAccepted: true };
    for (const response of [
      await seller.agent.post('/api/listings').set(seller.headers).send(input).expect(400),
      await seller.agent.patch(`/api/listings/${listing.id}`).set(seller.headers).send(input).expect(400),
    ]) {
      expect(response.body.error.fieldErrors[field]).toContain('Price must be at least ₹1. Choose Free for a giveaway.');
    }
    const rows = await ctx.db.select().from(schema.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exactPrice).toBe(450);
  });
  it('enforces positive prices in the database and still permits free listings', async () => {
    const listing = await createDraft(seller, ctx.category.id, { exactPrice: 1 });
    for (const price of [-1, 0]) {
      await expect(ctx.db.update(schema.listings).set({ exactPrice: price }).where(eq(schema.listings.id, listing.id))).rejects.toThrow();
    }
    await expect(ctx.db.insert(schema.listings).values({ sellerId: seller.user.id, categoryId: ctx.category.id, title: 'Invalid range', description: 'Negative-price range', condition: 'GOOD', priceType: 'RANGE', minimumPrice: -10, maximumPrice: -1, location: 'Campus' })).rejects.toThrow();
    const free = await createDraft(seller, ctx.category.id, { priceType: 'FREE', exactPrice: null });
    expect(free.priceType).toBe('FREE');
    expect(free.exactPrice).toBeNull();
  });
  it('accepts a ten-character listing description',async()=>{const listing=await createDraft(seller,ctx.category.id,{description:'1234567890'});expect(listing.description).toBe('1234567890');});
  it('LIST-01 creates a private owner-bound draft',async()=>{const listing=await createDraft(seller,ctx.category.id);expect(listing.sellerId).toBe(seller.user.id);expect(listing.lifecycleState).toBe('DRAFT');expect(listing.submittedAt).toBeNull();expect((await request(ctx.app).get('/api/listings')).body.data).toHaveLength(0);const mod=await moderator();expect((await mod.agent.get('/api/admin/listings/pending').expect(200)).body.data).toHaveLength(0);});
  it('LIST-02 submission is pending, private, owner-visible and queued',async()=>{const listing=await draftWithImage();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(200);expect((await request(ctx.app).get('/api/listings')).body.data).toHaveLength(0);await request(ctx.app).get(`/api/listings/${listing.id}`).expect(404);const owner=await seller.agent.get(`/api/listings/${listing.id}`).expect(200);expect(owner.body.data.ownerPreview).toBe(true);expect(owner.body.data.moderationState).toBe('PENDING');expect(owner.body.data.submittedAt).toBeTruthy();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(409);const mod=await moderator();const queue=await mod.agent.get('/api/admin/listings/pending').expect(200);expect(queue.body.data[0].listing.id).toBe(listing.id);});
  it('LIST-03 and ADMIN-02 moderator approval activates listing, audits and notifies',async()=>{const listing=await draftWithImage();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers);await approve(listing.id).then((r)=>expect(r.status).toBe(200));const publicRows=await request(ctx.app).get('/api/listings').expect(200);expect(publicRows.body.data[0].id).toBe(listing.id);expect((await ctx.db.select().from(schema.adminAuditLogs))).toHaveLength(1);expect((await ctx.db.select().from(schema.notifications).where(eq(schema.notifications.userId,seller.user.id))).some((n)=>n.type==='LISTING_APPROVED')).toBe(true);const approvalEmail=(await ctx.db.select().from(schema.emailOutbox)).find((job)=>job.template==='listing_approved');expect(approvalEmail).toBeTruthy();expect(approvalEmail?.payload).toMatchObject({listingId:listing.id,listingTitle:listing.title});});
  it('LIST-04 rejection keeps listing hidden and shows the seller a reason',async()=>{const listing=await draftWithImage();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers);const mod=await moderator();await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send({decision:'REJECT',internalReason:'Image contains prohibited content',userVisibleReason:'Please replace the first image'}).expect(200);const owner=await seller.agent.get(`/api/listings/${listing.id}`).expect(200);expect(owner.body.data.rejectionReason).toBe('Please replace the first image');expect((await request(ctx.app).get('/api/listings')).body.data).toHaveLength(0);});
  it('LIST-05 material edits after approval return to pending and hide listing',async()=>{const listing=await draftWithImage();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers);await approve(listing.id);await seller.agent.patch(`/api/listings/${listing.id}`).set(seller.headers).send({title:'Updated algebra textbook',description:'Updated product details with enough information for a buyer.',categoryId:ctx.category.id,condition:'GOOD',conditionExplanation:'',priceType:'FIXED',exactPrice:400,negotiable:true,location:'Main campus',brand:'',defects:'',meetupPoint:'',ownershipAttested:true,usedPhysicalGoodsAttested:true,accurateDescriptionAttested:true,sellerPolicyAccepted:true}).expect(200);const row=(await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0];expect(row?.moderationState).toBe('PENDING');expect(row?.lifecycleState).toBe('DRAFT');expect((await request(ctx.app).get('/api/listings')).body.data).toHaveLength(0);});
  it('keeps an approved listing and its photos public when a staged replacement fails validation', async () => {
    const listing = await draftWithImage();
    await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(200);
    await approve(listing.id).then((response) => expect(response.status).toBe(200));
    const before = (await request(ctx.app).get(`/api/listings/${listing.id}`).expect(200)).body.data;
    const invalid = Buffer.from('not a product photo');
    const ticket = await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: invalid.length }).expect(201);
    const url = new URL(ticket.body.data.uploadUrl);
    await seller.agent.put(`${url.pathname}${url.search}`).set('content-type', 'image/jpeg').send(invalid).expect(204);
    await seller.agent.patch(`/api/listings/${listing.id}`).set(seller.headers).send(editPayload(ctx.category.id, {
      newImageIds: [ticket.body.data.imageId], removedImageIds: [before.images[0].id],
    })).expect(400);
    const after = (await request(ctx.app).get(`/api/listings/${listing.id}`).expect(200)).body.data;
    expect(after).toMatchObject({ title: before.title, moderationState: 'APPROVED', lifecycleState: 'ACTIVE' });
    expect(after.images.map((image: { id: string }) => image.id)).toEqual(before.images.map((image: { id: string }) => image.id));
  });

  it('keeps an approved listing public when an abandoned staged photo is removed', async () => {
    const listing = await draftWithImage();
    await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(200);
    await approve(listing.id).then((response) => expect(response.status).toBe(200));
    const before = (await request(ctx.app).get(`/api/listings/${listing.id}`).expect(200)).body.data;
    const ticket = await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers)
      .send({ mimeType: 'image/jpeg', byteSize: 100 }).expect(201);
    await seller.agent.delete(`/api/uploads/listings/${listing.id}/${ticket.body.data.imageId}`)
      .set(seller.headers).expect(204);
    const after = (await request(ctx.app).get(`/api/listings/${listing.id}`).expect(200)).body.data;
    expect(after).toMatchObject({ title: before.title, moderationState: 'APPROVED', lifecycleState: 'ACTIVE' });
    expect(after.images.map((image: { id: string }) => image.id)).toEqual(before.images.map((image: { id: string }) => image.id));
  });

  it('commits replacement photos and listing details together after staging succeeds', async () => {
    const listing = await draftWithImage();
    await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(200);
    await approve(listing.id).then((response) => expect(response.status).toBe(200));
    const before = (await seller.agent.get(`/api/listings/${listing.id}`).expect(200)).body.data;
    const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#765b80' } }).jpeg().toBuffer();
    const ticket = await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({ mimeType: 'image/jpeg', byteSize: image.length }).expect(201);
    const url = new URL(ticket.body.data.uploadUrl);
    await seller.agent.put(`${url.pathname}${url.search}`).set('content-type', 'image/jpeg').send(image).expect(204);
    const stillPublic = await request(ctx.app).get(`/api/listings/${listing.id}`).expect(200);
    expect(stillPublic.body.data.images.map((photo: { id: string }) => photo.id)).toEqual([before.images[0].id]);
    await seller.agent.patch(`/api/listings/${listing.id}`).set(seller.headers).send(editPayload(ctx.category.id, {
      newImageIds: [ticket.body.data.imageId], removedImageIds: [before.images[0].id],
    })).expect(200);
    await request(ctx.app).get(`/api/listings/${listing.id}`).expect(404);
    const owner = (await seller.agent.get(`/api/listings/${listing.id}`).expect(200)).body.data;
    expect(owner).toMatchObject({ title: 'Updated algebra textbook', moderationState: 'PENDING', lifecycleState: 'DRAFT' });
    expect(owner.images.map((photo: { id: string }) => photo.id)).toEqual([ticket.body.data.imageId]);
  });
  it('LIST-06 rejects edits by another user',async()=>{const listing=await createDraft(seller,ctx.category.id);const other=await login(ctx.app,'other-listing-user');await verifyPhone(other,'9987654321');const before=(await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0];await other.agent.patch(`/api/listings/${listing.id}`).set(other.headers).send({title:'Stolen edit'}).expect(400);const after=(await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0];expect(after?.title).toBe(before?.title);});
  it('ADMIN-01 and ADMIN-03 deny approval to users and support agents',async()=>{const listing=await draftWithImage();const user=await login(ctx.app,'ordinary-approver');await user.agent.post(`/api/admin/listings/${listing.id}/decision`).set(user.headers).send({decision:'APPROVE',internalReason:'not allowed'}).expect(403);const support=await login(ctx.app,'support-approver');await makeRole(ctx.db,support.user.id,'SUPPORT_AGENT');await support.agent.post(`/api/admin/listings/${listing.id}/decision`).set(support.headers).send({decision:'APPROVE',internalReason:'not allowed'}).expect(403);});
  it('LIST-08 and LIST-09 reject excessive and oversized image requests',async()=>{const listing=await createDraft(seller,ctx.category.id);for(let i=0;i<8;i++)await ctx.db.insert(schema.listingImages).values({listingId:listing.id,ownerId:seller.user.id,mimeType:'image/jpeg',byteSize:100,position:i});await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({mimeType:'image/jpeg',byteSize:100}).expect(400);const fresh=await createDraft(seller,ctx.category.id);await seller.agent.post(`/api/uploads/listings/${fresh.id}/presign`).set(seller.headers).send({mimeType:'image/jpeg',byteSize:6*1024*1024}).expect(413);});
  it('LIST-10 rejects MIME spoofing and cleans the temporary upload',async()=>{const listing=await createDraft(seller,ctx.category.id);const result=await uploadImage(seller,listing.id,Buffer.from('<script>alert(1)</script>'));expect(result.status).toBe(400);const image=(await ctx.db.select().from(schema.listingImages))[0];expect(image?.deletedAt).toBeTruthy();});
  it('accepts images of any pixel dimensions',async()=>{const listing=await createDraft(seller,ctx.category.id);const image=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).jpeg().toBuffer();await uploadImage(seller,listing.id,image).then((r)=>expect(r.status).toBe(200));});
  it('LIST-11 rejects SVG at presign',async()=>{const listing=await createDraft(seller,ctx.category.id);await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({mimeType:'image/svg+xml',byteSize:100}).expect(400);});
  it('does not accept an AI-image declaration path',async()=>{const listing=await createDraft(seller,ctx.category.id);await seller.agent.post(`/api/uploads/listings/${listing.id}/presign`).set(seller.headers).send({mimeType:'image/jpeg',byteSize:100,syntheticStatus:'SYNTHETIC_OR_MATERIALLY_ALTERED'}).expect(400);});
  it('blocks legacy AI-image records from submission, approval and public routes',async()=>{const listing=await draftWithImage();await ctx.db.update(schema.listingImages).set({syntheticStatus:'SYNTHETIC_OR_MATERIALLY_ALTERED'}).where(eq(schema.listingImages.listingId,listing.id));const submit=await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(400);expect(submit.body.error.code).toBe('AI_GENERATED_IMAGE_NOT_ALLOWED');await ctx.db.update(schema.listings).set({submittedAt:new Date()}).where(eq(schema.listings.id,listing.id));const approval=await approve(listing.id);expect(approval.status).toBe(400);expect(approval.body.error.code).toBe('AI_GENERATED_IMAGE_NOT_ALLOWED');await ctx.db.update(schema.listings).set({moderationState:'APPROVED',lifecycleState:'ACTIVE',approvedAt:new Date()}).where(eq(schema.listings.id,listing.id));expect((await request(ctx.app).get('/api/listings').expect(200)).body.data).toHaveLength(0);await request(ctx.app).get(`/api/listings/${listing.id}`).expect(404);});
  it('LIST-12 and LIST-13 pending direct URLs hide from guests but allow owner preview',async()=>{const listing=await draftWithImage();await request(ctx.app).get(`/api/listings/${listing.id}`).expect(404);const owner=await seller.agent.get(`/api/listings/${listing.id}`).expect(200);expect(owner.body.data.title).toBe(listing.title);});
  it('LIST-14 withdrawal hides a listing without counting a sale',async()=>{const listing=await draftWithImage();await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers);await approve(listing.id);await seller.agent.post(`/api/listings/${listing.id}/withdraw`).set(seller.headers).expect(200);const user=(await ctx.db.select().from(schema.users).where(eq(schema.users.id,seller.user.id)))[0];expect(user?.completedSales).toBe(0);expect((await request(ctx.app).get('/api/listings')).body.data).toHaveLength(0);});
  it('allows only the owner to delete a listing and removes it from their listings',async()=>{const listing=await createDraft(seller,ctx.category.id);const other=await login(ctx.app,'listing-delete-other');await other.agent.delete(`/api/listings/${listing.id}`).set(other.headers).expect(404);await seller.agent.delete(`/api/listings/${listing.id}`).set(seller.headers).expect(204);expect((await seller.agent.get('/api/my-listings').set(seller.headers).expect(200)).body.data).toHaveLength(0);const mod=await moderator();expect((await mod.agent.get('/api/admin/listings/pending').set(mod.headers).expect(200)).body.data).toHaveLength(0);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.deletedAt).toBeTruthy();});
  it('allows a moderator to delete a listing and records an audit event',async()=>{const listing=await createDraft(seller,ctx.category.id);const mod=await moderator();await mod.agent.delete(`/api/admin/listings/${listing.id}`).set(mod.headers).expect(204);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.deletedAt).toBeTruthy();expect((await ctx.db.select().from(schema.adminAuditLogs)).some((entry)=>entry.action==='LISTING_DELETE'&&entry.targetId===listing.id)).toBe(true);});  it('LIST-15 refuses directly marking a listing sold',async()=>{const listing=await createDraft(seller,ctx.category.id);await seller.agent.post(`/api/listings/${listing.id}/sold`).set(seller.headers).expect(409);});
});
