import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient } from 'socket.io-client';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import * as schema from '../../apps/api/src/db/schema';
import { attachSocket } from '../../apps/api/src/socket';
import { createDraft, login, makeRole, setup, uploadImage, verifyPhone } from './helper';

let ctx:Awaited<ReturnType<typeof setup>>;let seller:Awaited<ReturnType<typeof login>>;let buyer:Awaited<ReturnType<typeof login>>;let listing:any;
beforeEach(async()=>{ctx=await setup();seller=await login(ctx.app,'chat-seller');buyer=await login(ctx.app,'chat-buyer');await verifyPhone(seller);await verifyPhone(buyer,'9987654321');listing=await createDraft(seller,ctx.category.id);await uploadImage(seller,listing.id);await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers);const mod=await login(ctx.app,'chat-moderator');await makeRole(ctx.db,mod.user.id,'MODERATOR');await mod.agent.post(`/api/admin/listings/${listing.id}/decision`).set(mod.headers).send({decision:'APPROVE',internalReason:'Listing complies with marketplace policy'}).expect(200);});afterEach(async()=>ctx?.client.close());

async function conversation(){return (await buyer.agent.post('/api/conversations').set(buyer.headers).send({listingId:listing.id}).expect(201)).body.data;}

describe('chat acceptance',()=>{
  it('returns loadable request cover images to both participants and omits deleted images', async () => {
    const c = await conversation();
    await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers)
      .send({ body: 'I would like to reserve this item.', clientId: crypto.randomUUID() }).expect(201);
    await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(201);
    for (const participant of [buyer, seller]) {
      const rows = (await participant.agent.get('/api/transactions').expect(200)).body.data;
      const url = new URL(rows[0].coverImageUrl);
      const image = await participant.agent.get(`${url.pathname}${url.search}`).expect(200);
      expect(image.headers['content-type']).toMatch(/^image\//);
    }
    await ctx.db.update(schema.listingImages).set({ deletedAt: new Date() }).where(eq(schema.listingImages.listingId, listing.id));
    const rows = (await buyer.agent.get('/api/transactions').expect(200)).body.data;
    expect(rows[0].coverImageUrl).toBeNull();
  });
  it('broadcasts reservation changes only to participants, including after reconnect, without leaking exchange codes', async () => {
    const c = await conversation();
    await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers)
      .send({ body: 'I would like to reserve this item.', clientId: crypto.randomUUID() }).expect(201);
    const outsider = await login(ctx.app, 'reservation-outsider');
    await verifyPhone(outsider, '9954321098');
    const server = createServer(ctx.app);
    const io = attachSocket(server, ctx.db, ctx.config);
    ctx.app.set('io', io);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const sockets = [buyer, seller, outsider].map((auth) => socketClient(`http://127.0.0.1:${port}`, {
      extraHeaders: { Cookie: auth.cookie }, transports: ['websocket'], autoConnect: false,
    }));
    const events: unknown[][] = [[], [], []];
    try {
      await Promise.all(sockets.map((connection, index) => new Promise<void>((resolve, reject) => {
        connection.on('transaction:updated', (event: unknown) => events[index]!.push(event));
        connection.once('connect', resolve);
        connection.once('connect_error', reject);
        connection.connect();
      })));
      const assertEvents = async (count: number) => {
        await expect.poll(() => events.slice(0, 2).map((received) => received.length)).toEqual([count, count]);
        for (const event of events.flat()) expect(event).toEqual({ listingId: listing.id });
        expect(events[2]).toEqual([]);
      };
      const request = (await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(201)).body.data;
      await assertEvents(1);
      const sellerSocket = sockets[1]!;
      sellerSocket.disconnect();
      await new Promise<void>((resolve, reject) => {
        sellerSocket.once('connect', resolve);
        sellerSocket.once('connect_error', reject);
        sellerSocket.connect();
      });
      await seller.agent.post(`/api/transactions/${request.id}/accept`).set(seller.headers).expect(200);
      await assertEvents(2);
      const rotated = await buyer.agent.post(`/api/transactions/${request.id}/exchange-code/rotate`).set(buyer.headers).expect(200);
      await assertEvents(3);
      const wrong = rotated.body.data.exchangeCode === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < 5; attempt++) {
        await seller.agent.post(`/api/transactions/${request.id}/exchange/complete`).set(seller.headers)
          .send({ code: wrong }).expect(attempt === 4 ? 429 : 400);
      }
      await assertEvents(4);
      await buyer.agent.post(`/api/transactions/${request.id}/cancel`).set(buyer.headers).expect(200);
      await assertEvents(5);
      const next = (await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(201)).body.data;
      await seller.agent.post(`/api/transactions/${next.id}/accept`).set(seller.headers).expect(200);
      const requests = (await buyer.agent.get('/api/transactions').expect(200)).body.data;
      const code = requests.find((row: { id: string }) => row.id === next.id).exchangeCode;
      await seller.agent.post(`/api/transactions/${next.id}/exchange/complete`).set(seller.headers).send({ code }).expect(200);
      await assertEvents(8);
    } finally {
      sockets.forEach((connection) => connection.close());
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('saves favourites idempotently, lists them privately and keeps the listing counter accurate',async()=>{await buyer.agent.post(`/api/favourites/${listing.id}`).set(buyer.headers).expect(201);await buyer.agent.post(`/api/favourites/${listing.id}`).set(buyer.headers).expect(200);const saved=await buyer.agent.get('/api/favourites').expect(200);expect(saved.body.data).toHaveLength(1);expect(saved.body.data[0]).toMatchObject({id:listing.id,favouriteCount:1});expect(saved.body.data[0].coverImageUrl).toContain('/api/uploads/local-read');expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.favouriteCount).toBe(1);await buyer.agent.delete(`/api/favourites/${listing.id}`).set(buyer.headers).expect(204);await buyer.agent.delete(`/api/favourites/${listing.id}`).set(buyer.headers).expect(204);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.favouriteCount).toBe(0);expect((await buyer.agent.get('/api/favourites')).body.data).toEqual([]);});
  it('does not allow unavailable drafts to be favourited',async()=>{const draft=await createDraft(seller,ctx.category.id,{title:'Private draft listing'});const response=await buyer.agent.post(`/api/favourites/${draft.id}`).set(buyer.headers).expect(404);expect(response.body.error.code).toBe('LISTING_UNAVAILABLE');expect(await ctx.db.select().from(schema.favourites)).toHaveLength(0);});
  it('CHAT-01 requires phone verification',async()=>{const user=await login(ctx.app,'chat-unverified');await user.agent.post('/api/conversations').set(user.headers).send({listingId:listing.id}).expect(403);});
  it('CHAT-02 returns one unique conversation for repeated starts',async()=>{const first=await buyer.agent.post('/api/conversations').set(buyer.headers).send({listingId:listing.id}).expect(201);const second=await buyer.agent.post('/api/conversations').set(buyer.headers).send({listingId:listing.id}).expect(200);expect(second.body.data.id).toBe(first.body.data.id);expect(await ctx.db.select().from(schema.conversations)).toHaveLength(1);});
  it('CHAT-03 rejects unrelated conversation reads',async()=>{const c=await conversation();const outsider=await login(ctx.app,'chat-outsider');await verifyPhone(outsider,'9976543210');await outsider.agent.get(`/api/conversations/${c.id}/messages`).expect(403);});
  it('CHAT-04 websocket rejects arbitrary room subscriptions',async()=>{const c=await conversation();const outsider=await login(ctx.app,'socket-outsider');await verifyPhone(outsider,'9965432109');const server=createServer(ctx.app);const io=attachSocket(server,ctx.db,ctx.config);await new Promise<void>((resolve)=>server.listen(0,resolve));const address=server.address();const port=typeof address==='object'&&address?address.port:0;const socket=socketClient(`http://127.0.0.1:${port}`,{extraHeaders:{Cookie:outsider.cookie},transports:['websocket']});const result=await new Promise<any>((resolve,reject)=>{socket.on('connect',()=>socket.emit('conversation:subscribe',c.id,resolve));socket.on('connect_error',reject);});expect(result.ok).toBe(false);socket.close();await new Promise<void>((resolve)=>io.close(()=>resolve()));await new Promise<void>((resolve)=>server.close(()=>resolve()));});
  it('delivers new messages to the recipient inbox after reconnect without a refresh',async()=>{
    const c=await conversation();
    const server=createServer(ctx.app);
    const io=attachSocket(server,ctx.db,ctx.config);
    await new Promise<void>((resolve)=>server.listen(0,resolve));
    const address=server.address();
    const port=typeof address==='object'&&address?address.port:0;
    const sellerSocket=socketClient(`http://127.0.0.1:${port}`,{extraHeaders:{Cookie:seller.cookie},transports:['websocket']});
    const buyerSocket=socketClient(`http://127.0.0.1:${port}`,{extraHeaders:{Cookie:buyer.cookie},transports:['websocket']});
    try {
      await Promise.all([
        new Promise<void>((resolve,reject)=>{sellerSocket.once('connect',resolve);sellerSocket.once('connect_error',reject);}),
        new Promise<void>((resolve,reject)=>{buyerSocket.once('connect',resolve);buyerSocket.once('connect_error',reject);}),
      ]);
      sellerSocket.disconnect();
      const reconnected=new Promise<void>((resolve,reject)=>{sellerSocket.once('connect',resolve);sellerSocket.once('connect_error',reject);});
      sellerSocket.connect();
      await reconnected;
      const incoming=new Promise<any>((resolve)=>sellerSocket.once('message:new',resolve));
      const acknowledgement=new Promise<any>((resolve)=>buyerSocket.emit('message:send',{conversationId:c.id,body:'Visible without refreshing',clientId:crypto.randomUUID()},resolve));
      expect((await acknowledgement).ok).toBe(true);
      expect((await incoming).body).toBe('Visible without refreshing');
    } finally {
      sellerSocket.close();
      buyerSocket.close();
      await new Promise<void>((resolve)=>io.close(()=>resolve()));
      await new Promise<void>((resolve)=>server.close(()=>resolve()));
    }
  });
  it('CHAT-05 persists messages and CHAT-07 queues exactly one first-message email',async()=>{const c=await conversation();await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Is the textbook still available?',clientId:crypto.randomUUID()}).expect(201);await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'I can meet tomorrow.',clientId:crypto.randomUUID()}).expect(201);const reopened=await buyer.agent.get(`/api/conversations/${c.id}/messages`).expect(200);expect(reopened.body.data).toHaveLength(2);expect((await ctx.db.select().from(schema.emailOutbox)).filter((job)=>job.template==='first-conversation-message')).toHaveLength(1);});
  it('warns before sending scam-risk text and records only risk codes after confirmation',async()=>{const c=await conversation();const clientId=crypto.randomUUID();const body='Please share your OTP to confirm the booking';const warning=await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body,clientId}).expect(409);expect(warning.body.error.code).toBe('SCAM_WARNING_REQUIRED');expect(warning.body.error.details.riskCodes).toContain('OTP_OR_PASSWORD');expect(await ctx.db.select().from(schema.messages)).toHaveLength(0);await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body,clientId,safetyConfirmationToken:warning.body.error.details.confirmationToken}).expect(201);const risks=await ctx.db.select().from(schema.messageRiskEvents);expect(risks).toHaveLength(1);expect(risks[0]?.riskCodes).toContain('OTP_OR_PASSWORD');expect(JSON.stringify(risks[0])).not.toContain(body);});
  it('CHAT-06 duplicate client IDs are idempotent after reconnect',async()=>{const c=await conversation();const clientId=crypto.randomUUID();await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'One message',clientId}).expect(201);await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'One message',clientId}).expect(200);expect(await ctx.db.select().from(schema.messages)).toHaveLength(1);});
  it('CHAT-08 throttles excessive message traffic',async()=>{const c=await conversation();let status=0;for(let i=0;i<12;i++){const response=await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:`Message ${i}`,clientId:crypto.randomUUID()});status=response.status;if(status===429)break;}expect(status).toBe(429);});
  it('CHAT-09 preserves script input as inert text for React escaping',async()=>{const c=await conversation();const body='<script>globalThis.pwned=true</script>';await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body,clientId:crypto.randomUUID()}).expect(201);const rows=await buyer.agent.get(`/api/conversations/${c.id}/messages`);expect(rows.body.data[0].body).toBe(body);});
  it('CHAT-10 blocked users cannot send and create no notification',async()=>{const c=await conversation();await seller.agent.post(`/api/blocks/${buyer.user.id}`).set(seller.headers).expect(201);const before=(await ctx.db.select().from(schema.notifications)).length;await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Blocked message',clientId:crypto.randomUUID()}).expect(403);expect(await ctx.db.select().from(schema.notifications)).toHaveLength(before);});
  it('rejects self-blocking and allows messages again after the blocker removes a block',async()=>{const c=await conversation();const self=await seller.agent.post(`/api/blocks/${seller.user.id}`).set(seller.headers).expect(400);expect(self.body.error.code).toBe('SELF_BLOCK');await seller.agent.post(`/api/blocks/${buyer.user.id}`).set(seller.headers).expect(201);await seller.agent.delete(`/api/blocks/${buyer.user.id}`).set(seller.headers).expect(204);await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Message after unblock',clientId:crypto.randomUUID()}).expect(201);});
  it('shows unread conversation counts and marks received messages as read when opened',async()=>{const c=await conversation();await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Unread seller message',clientId:crypto.randomUUID()}).expect(201);const inbox=await seller.agent.get('/api/conversations').expect(200);expect(inbox.body.data).toHaveLength(1);expect(inbox.body.data[0]).toMatchObject({id:c.id,otherUserId:buyer.user.id,unread:1});await seller.agent.get(`/api/conversations/${c.id}/messages`).expect(200);const reopened=await seller.agent.get('/api/conversations').expect(200);expect(reopened.body.data[0].unread).toBe(0);});
});

describe('transaction and review acceptance',()=>{
  async function requestedBy(session: Awaited<ReturnType<typeof login>>){
    const conversationResponse=await session.agent.post('/api/conversations').set(session.headers).send({listingId:listing.id});
    expect([200,201]).toContain(conversationResponse.status);
    const conversation=conversationResponse.body.data;
    await session.agent.post(`/api/conversations/${conversation.id}/messages`).set(session.headers).send({body:'I am interested in reserving this item.',clientId:crypto.randomUUID()}).expect(201);
    return (await session.agent.post(`/api/conversations/${conversation.id}/reservation-requests`).set(session.headers).expect(201)).body.data;
  }
  async function requested(){return requestedBy(buyer);}
  async function reservedWithCode(){
    const transaction=await requested();
    await seller.agent.post(`/api/transactions/${transaction.id}/accept`).set(seller.headers).expect(200);
    const buyerTransactions=await buyer.agent.get('/api/transactions').expect(200);
    const reserved=buyerTransactions.body.data.find((row:any)=>row.id===transaction.id);
    expect(reserved.exchangeCode).toMatch(/^\d{6}$/);
    return {transaction,code:reserved.exchangeCode as string};
  }
  async function completeWithCode(){
    const reserved=await reservedWithCode();
    await seller.agent.post(`/api/transactions/${reserved.transaction.id}/exchange/complete`).set(seller.headers).send({code:reserved.code}).expect(200);
    return reserved.transaction;
  }
  it('separates seller ratings from buyer feedback and exposes buyer feedback only to the conversation seller', async () => {
    const tx = await completeWithCode();
    await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({ rating: 4, text: 'Accurate listing', tags: [] }).expect(201);
    const buyerReview = await seller.agent.post(`/api/transactions/${tx.id}/reviews`).set(seller.headers).send({ rating: 5, text: 'Prompt buyer', tags: [] }).expect(201);
    const sellerProfile = (await request(ctx.app).get(`/api/sellers/${seller.user.id}`).expect(200)).body.data;
    expect(sellerProfile).toMatchObject({ averageRating: 4, reviewCount: 1 });
    const buyerAsSeller = (await request(ctx.app).get(`/api/sellers/${buyer.user.id}`).expect(200)).body.data;
    expect(buyerAsSeller).toMatchObject({ averageRating: 0, reviewCount: 0, recentReviews: [], completedSales: 0 });
    const buyerListing = await createDraft(buyer, ctx.category.id);
    expect((await buyer.agent.get(`/api/listings/${buyerListing.id}`).expect(200)).body.data.seller).toMatchObject({ rating: 0, reviewCount: 0 });
    expect((await seller.agent.get(`/api/listings/${listing.id}`).expect(200)).body.data.seller).toMatchObject({ rating: 4, reviewCount: 1 });
    const c = (await seller.agent.get('/api/conversations').expect(200)).body.data[0];
    const path = `/api/conversations/${c.id}/buyer-reputation`;
    const feedback = (await seller.agent.get(path).expect(200)).body.data;
    expect(feedback).toMatchObject({ averageRating: 5, reviewCount: 1 });
    expect(feedback.recentReviews).toEqual([expect.objectContaining({ text: 'Prompt buyer' })]);
    await buyer.agent.get(path).expect(403);
    await request(ctx.app).get(path).expect(401);
    const outsider = await login(ctx.app, 'reputation-outsider');
    await verifyPhone(outsider, '9954321098');
    await outsider.agent.get(path).expect(403);
    await ctx.db.update(schema.reviews).set({ hiddenAt: new Date() }).where(eq(schema.reviews.id, buyerReview.body.data.id));
    expect((await seller.agent.get(path).expect(200)).body.data).toMatchObject({ averageRating: 0, reviewCount: 0, recentReviews: [] });
    expect((await seller.agent.get(`/api/sellers/${seller.user.id}`).expect(200)).body.data.averageRating).toBe(4);
  });

  it('ranks sellers using only their seller reviews and counts repeated star values correctly', async () => {
    for (const rating of [4, 4, 2]) {
      const item = await createDraft(seller, ctx.category.id);
      const [tx] = await ctx.db.insert(schema.transactions).values({ listingId: item.id, sellerId: seller.user.id, buyerId: buyer.user.id, status: 'COMPLETED', completedAt: new Date() }).returning();
      await ctx.db.insert(schema.reviews).values({ transactionId: tx!.id, reviewerId: buyer.user.id, revieweeId: seller.user.id, rating, text: 'Seller feedback' });
    }
    const purchase = await createDraft(buyer, ctx.category.id);
    const [tx] = await ctx.db.insert(schema.transactions).values({ listingId: purchase.id, sellerId: buyer.user.id, buyerId: seller.user.id, status: 'COMPLETED', completedAt: new Date() }).returning();
    await ctx.db.insert(schema.reviews).values({ transactionId: tx!.id, reviewerId: buyer.user.id, revieweeId: seller.user.id, rating: 5, text: 'Buyer feedback must not count' });
    for (const scope of ['monthly', 'all-time']) {
      const [ranked] = (await request(ctx.app).get(`/api/leaderboard?scope=${scope}`).expect(200)).body.data;
      expect(ranked.id).toBe(seller.user.id);
      expect(Number(ranked.completedSales)).toBe(3);
      expect(Number(ranked.reviewCount)).toBe(3);
      expect(Number(ranked.averageRating)).toBeCloseTo(10 / 3);
    }
    const profile = (await request(ctx.app).get(`/api/sellers/${seller.user.id}`).expect(200)).body.data;
    expect(profile.averageRating).toBeCloseTo(10 / 3);
    expect(profile.recentReviews).toHaveLength(3);
  });
  it('accepts one simultaneous review and persists each participant’s reviewed state', async () => {
    const tx = await completeWithCode();
    const reviewState = async (auth: typeof buyer) => (await auth.agent.get('/api/transactions').expect(200)).body.data.find((row: { id: string }) => row.id === tx.id).reviewSubmitted;
    expect(await reviewState(buyer)).toBe(false);
    const results = await Promise.all([5, 4].map((rating) => buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({ rating, text: 'A smooth exchange', tags: [] })));
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(results.find((response) => response.status === 409)?.body.error.code).toBe('DUPLICATE_REVIEW');
    expect(await ctx.db.select().from(schema.reviews)).toHaveLength(1);
    expect(await ctx.db.select().from(schema.notifications).where(eq(schema.notifications.type, 'REVIEW_RECEIVED'))).toHaveLength(1);
    expect(await reviewState(buyer)).toBe(true);
    expect(await reviewState(seller)).toBe(false);
    await seller.agent.post(`/api/transactions/${tx.id}/reviews`).set(seller.headers).send({ rating: 5, text: 'Prompt collection', tags: [] }).expect(201);
    expect(await reviewState(seller)).toBe(true);
    // Hiding or soft-deleting feedback must not reopen the review slot.
    await ctx.db.update(schema.reviews).set({ hiddenAt: new Date(), deletedAt: new Date() }).where(eq(schema.reviews.reviewerId, buyer.user.id));
    expect(await reviewState(buyer)).toBe(true);
    await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({ rating: 5, text: 'Another review', tags: [] }).expect(409);
    expect(await ctx.db.select().from(schema.reviews)).toHaveLength(2);
  });
  it('returns monthly and all-time leaderboard results without a timestamp encoding failure',async()=>{
    const [monthly,allTime]=await Promise.all([
      seller.agent.get('/api/leaderboard?scope=monthly').expect(200),
      seller.agent.get('/api/leaderboard?scope=all-time').expect(200),
    ]);
    expect(monthly.body.data).toEqual([]);
    expect(allTime.body.data).toEqual([]);
  });
  it('TX-01 requires a buyer message and creates a reservation request only from its conversation',async()=>{const c=await conversation();const early=await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(409);expect(early.body.error.code).toBe('MESSAGE_REQUIRED');await seller.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(seller.headers).expect(403);await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Is this still available?',clientId:crypto.randomUUID()}).expect(201);const tx=(await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(201)).body.data;expect(tx.status).toBe('REQUESTED');const notice=(await ctx.db.select().from(schema.notifications)).find((row)=>row.type==='PURCHASE_REQUEST');expect(notice).toMatchObject({title:'Reservation request',href:`/requests?view=received#transaction-${tx.id}`});const repeated=(await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(200)).body.data;expect(repeated.id).toBe(tx.id);const legacy=await buyer.agent.post('/api/transactions').set(buyer.headers).send({listingId:listing.id}).expect(409);expect(legacy.body.error.code).toBe('CHAT_REQUIRED');});
  it('rejects reservation requests when either conversation member has blocked the other',async()=>{const c=await conversation();await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'I would like to reserve this.',clientId:crypto.randomUUID()}).expect(201);await seller.agent.post(`/api/blocks/${buyer.user.id}`).set(seller.headers).expect(201);const response=await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(403);expect(response.body.error.code).toBe('USER_BLOCKED');expect(await ctx.db.select().from(schema.transactions)).toHaveLength(0);});
  it('rejects reservation requests after the listing becomes unavailable',async()=>{const c=await conversation();await buyer.agent.post(`/api/conversations/${c.id}/messages`).set(buyer.headers).send({body:'Can this be reserved?',clientId:crypto.randomUUID()}).expect(201);await ctx.db.update(schema.listings).set({lifecycleState:'SOLD'}).where(eq(schema.listings.id,listing.id));const response=await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(409);expect(response.body.error.code).toBe('LISTING_NOT_AVAILABLE');expect(await ctx.db.select().from(schema.transactions)).toHaveLength(0);});
  it('returns identifiable listing details and queues the complete transaction email lifecycle',async()=>{const tx=await requested();const buyerRows=await buyer.agent.get('/api/transactions').expect(200);expect(buyerRows.body.data[0]).toMatchObject({listingId:listing.id,listingTitle:listing.title,listingPrice:'₹450',role:'BUYER'});expect(buyerRows.body.data[0].createdAt).toBeTruthy();await seller.agent.post(`/api/transactions/${tx.id}/accept`).set(seller.headers).expect(200);const reserved=(await buyer.agent.get('/api/transactions').expect(200)).body.data.find((row:any)=>row.id===tx.id);await seller.agent.post(`/api/transactions/${tx.id}/exchange/complete`).set(seller.headers).send({code:reserved.exchangeCode}).expect(200);const jobs=(await ctx.db.select().from(schema.emailOutbox)).filter((job)=>job.template.startsWith('purchase-')||job.template.startsWith('transaction-completed'));expect(jobs.map((job)=>job.template).sort()).toEqual(['purchase-accepted','purchase-request','transaction-completed-buyer','transaction-completed-seller']);expect(jobs.find((job)=>job.template==='purchase-request')?.recipientUserId).toBe(seller.user.id);expect(jobs.find((job)=>job.template==='purchase-accepted')?.recipientUserId).toBe(buyer.user.id);});
  it('honours transaction email opt-outs before queueing',async()=>{await seller.agent.patch('/api/email-preferences').set(seller.headers).send({transactionUpdates:false}).expect(200);await requested();expect((await ctx.db.select().from(schema.emailOutbox)).filter((job)=>job.template==='purchase-request')).toHaveLength(0);});
  it('TX-03 reserves atomically and records the buyer',async()=>{const tx=await requested();const accepted=await seller.agent.post(`/api/transactions/${tx.id}/accept`).set(seller.headers).expect(200);expect(accepted.body.data.status).toBe('RESERVED');const row=(await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0];expect(row?.lifecycleState).toBe('RESERVED');expect(row?.reservedBuyerId).toBe(buyer.user.id);const c=(await ctx.db.select().from(schema.conversations))[0]!;const repeated=(await buyer.agent.post(`/api/conversations/${c.id}/reservation-requests`).set(buyer.headers).expect(200)).body.data;expect(repeated).toMatchObject({id:tx.id,status:'RESERVED'});});
  it('TX-04 only one concurrent acceptance can reserve a listing',async()=>{const other=await login(ctx.app,'second-buyer');await verifyPhone(other,'9965432109');const secondSellerSession=await login(ctx.app,'chat-seller');const [one,two]=await Promise.all([requestedBy(buyer),requestedBy(other)]);const results=await Promise.all([seller.agent.post(`/api/transactions/${one.id}/accept`).set(seller.headers),secondSellerSession.agent.post(`/api/transactions/${two.id}/accept`).set(secondSellerSession.headers)]);expect(results.map((r)=>r.status).sort()).toEqual([200,409]);expect((await ctx.db.select().from(schema.transactions).where(eq(schema.transactions.status,'RESERVED')))).toHaveLength(1);});
  it('TX-05 exposes the exchange code only to the buyer and requires it instead of manual handover',async()=>{const {transaction,code}=await reservedWithCode();const sellerTransactions=await seller.agent.get('/api/transactions').expect(200);expect(sellerTransactions.body.data.find((row:any)=>row.id===transaction.id)).not.toHaveProperty('exchangeCode');await seller.agent.post(`/api/transactions/${transaction.id}/handover`).set(seller.headers).expect(409).expect((response)=>expect(response.body.error.code).toBe('EXCHANGE_CODE_REQUIRED'));expect(code).toMatch(/^\d{6}$/);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.lifecycleState).toBe('RESERVED');});
  it('TX-06 redeems the code, sells the listing and increments completed sales exactly once',async()=>{const {transaction,code}=await reservedWithCode();await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code}).expect(200);await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code}).expect(200);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.lifecycleState).toBe('SOLD');expect((await ctx.db.select().from(schema.users).where(eq(schema.users.id,seller.user.id)))[0]?.completedSales).toBe(1);});
  it('locks after five incorrect codes and lets only the buyer rotate to a fresh code',async()=>{const {transaction,code}=await reservedWithCode();const wrong=code==='000000'?'000001':'000000';for(let attempt=0;attempt<4;attempt++)await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code:wrong}).expect(400);await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code:wrong}).expect(429);await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code}).expect(429);await seller.agent.post(`/api/transactions/${transaction.id}/exchange-code/rotate`).set(seller.headers).expect(403);const rotated=await buyer.agent.post(`/api/transactions/${transaction.id}/exchange-code/rotate`).set(buyer.headers).expect(200);expect(rotated.body.data.exchangeCode).toMatch(/^\d{6}$/);expect(rotated.body.data.exchangeCode).not.toBe(code);expect(rotated.body.data.exchangeCodeLocked).toBe(false);await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code}).expect(400);await seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code:rotated.body.data.exchangeCode}).expect(200);});
  it('does not double-count two concurrent redemptions',async()=>{const {transaction,code}=await reservedWithCode();const secondSellerSession=await login(ctx.app,'chat-seller');const results=await Promise.all([seller.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(seller.headers).send({code}),secondSellerSession.agent.post(`/api/transactions/${transaction.id}/exchange/complete`).set(secondSellerSession.headers).send({code})]);expect(results.map((response)=>response.status).every((status)=>[200,409].includes(status))).toBe(true);expect((await ctx.db.select().from(schema.users).where(eq(schema.users.id,seller.user.id)))[0]?.completedSales).toBe(1);});
  it('keeps the legacy buyer receipt path for transactions already handed over',async()=>{const {transaction}=await reservedWithCode();await ctx.db.update(schema.transactions).set({status:'HANDED_OVER'}).where(eq(schema.transactions.id,transaction.id));await buyer.agent.post(`/api/transactions/${transaction.id}/complete`).set(buyer.headers).expect(200);expect((await ctx.db.select().from(schema.users).where(eq(schema.users.id,seller.user.id)))[0]?.completedSales).toBe(1);});
  it('does not expose exchange-code state in account exports',async()=>{await reservedWithCode();const exported=await buyer.agent.get('/api/account/export').expect(200);const serialized=JSON.stringify(exported.body);expect(serialized).not.toContain('exchangeCode');expect(serialized).not.toContain('exchange_code');});
  it('TX-07 cancellation releases reservation without a sale',async()=>{const tx=await requested();await seller.agent.post(`/api/transactions/${tx.id}/accept`).set(seller.headers);await buyer.agent.post(`/api/transactions/${tx.id}/cancel`).set(buyer.headers).expect(200);expect((await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,listing.id)))[0]?.lifecycleState).toBe('ACTIVE');expect((await ctx.db.select().from(schema.users).where(eq(schema.users.id,seller.user.id)))[0]?.completedSales).toBe(0);const cancelled=(await ctx.db.select().from(schema.emailOutbox)).find((job)=>job.template==='transaction-cancelled');expect(cancelled?.recipientUserId).toBe(seller.user.id);});
  it('TX-08 unrelated users cannot change transaction state',async()=>{const tx=await requested();const outsider=await login(ctx.app,'tx-outsider');await verifyPhone(outsider,'9954321098');await outsider.agent.post(`/api/transactions/${tx.id}/accept`).set(outsider.headers).expect(409);});
  it('REV-01 blocks early reviews; REV-02 creates verified review; REV-03 duplicate and REV-04 self review are blocked',async()=>{const tx=await requested();await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({rating:5,text:'Too early',tags:[]}).expect(409);await seller.agent.post(`/api/transactions/${tx.id}/accept`).set(seller.headers);const buyerTransactions=await buyer.agent.get('/api/transactions');const code=buyerTransactions.body.data.find((row:any)=>row.id===tx.id).exchangeCode;await seller.agent.post(`/api/transactions/${tx.id}/exchange/complete`).set(seller.headers).send({code});const review=await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({rating:5,text:'Product exactly as described',tags:['PRODUCT_AS_DESCRIBED']}).expect(201);expect(review.body.data.verifiedTransaction).toBe(true);await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({rating:4,text:'Duplicate',tags:[]}).expect(409);const stored=(await ctx.db.select().from(schema.reviews))[0];expect(stored?.revieweeId).toBe(seller.user.id);expect(stored?.reviewerId).not.toBe(stored?.revieweeId);});
  it('REV-05 aggregates valid reviews and REV-06 hiding removes them and audits',async()=>{const tx=await completeWithCode();const review=await buyer.agent.post(`/api/transactions/${tx.id}/reviews`).set(buyer.headers).send({rating:4,text:'Good transaction',tags:[]});expect((await buyer.agent.get(`/api/sellers/${seller.user.id}`)).body.data.averageRating).toBe(4);const mod=await login(ctx.app,'review-moderator');await makeRole(ctx.db,mod.user.id,'MODERATOR');await mod.agent.post(`/api/admin/reviews/${review.body.data.id}/hide`).set(mod.headers).send({reason:'Reported abusive content'}).expect(200);expect((await buyer.agent.get(`/api/sellers/${seller.user.id}`)).body.data.averageRating).toBe(0);expect((await ctx.db.select().from(schema.adminAuditLogs))).toHaveLength(2);});
});
