import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import * as schema from '../../apps/api/src/db/schema';
import { createDraft, login, setup, uploadImage, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx?.client.close();
});

describe('India compliance controls', () => {
  it('publishes the independent-platform, operator, ranking and processor disclosures', async () => {
    const result = await request(ctx.app).get('/api/compliance').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.nonAffiliation).toContain('not affiliated with');
    expect(result.body.data.transactionModel).toContain('does not provide payment processing');
    expect(result.body.data.ranking).toContain('three times favourites');
    expect(result.body.data.operator.email).toBe('support@uni.rocks');
    expect(result.body.data.operator).not.toHaveProperty('phone');
    expect(result.body.data.processors.length).toBeGreaterThanOrEqual(5);
  });

  it('allows ordinary Google sign-in but blocks marketplace actions until every eligibility control is complete', async () => {
    const auth = await login(ctx.app, 'ordinary-google-account');
    expect(auth.user.email).toMatch(/@gmail\.com$/);
    await auth.agent.post('/api/phone/send').set(auth.headers).send({ phone: '9876543210' }).expect(200);
    await auth.agent.post('/api/phone/verify').set(auth.headers).send({ phone: '9876543210', code: '999999' }).expect(200);
    const denied = await auth.agent.post('/api/listings').set(auth.headers).send({}).expect(403);
    expect(denied.body.error.code).toBe('STUDENT_EMAIL_VERIFICATION_REQUIRED');
  });

  it('requires an approved separate academic email and an explicit 18+ declaration', async () => {
    const auth = await login(ctx.app, 'student-eligibility');
    const domain = await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'student@gmail.com' }).expect(400);
    expect(domain.body.error.code).toBe('ACADEMIC_DOMAIN_NOT_APPROVED');
    await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'student@stu.upes.ac.in' }).expect(200);
    await auth.agent.post('/api/student-email/verify').set(auth.headers).send({ email: 'student@stu.upes.ac.in', code: '999999' }).expect(200);
    await auth.agent.post('/api/onboarding/complete').set(auth.headers).send({ displayName: 'Eligible Student', adultAttested: false, acceptTerms: true, acknowledgePrivacy: true, acceptCommunityRules: true, policyVersion: '2026-08-25' }).expect(400);
  });

  it('accepts a matching MSG91 student-email token once and never queues an SMTP OTP', async () => {
    const auth = await login(ctx.app, 'msg91-student-email');
    const providerConfig = {
      ...ctx.config,
      DEV_MODE: false,
      MSG91_AUTH_KEY: 'server-auth-key',
      MSG91_WIDGET_ID: 'student-email-widget',
      MSG91_TOKEN_AUTH: 'browser-token-auth',
    };
    const providerApp = createApp({
      db: ctx.db,
      config: providerConfig,
      googleVerifier: { verify: async () => { throw new Error('Not used in this test'); } },
    });
    const providerRequest = () => request(providerApp).post('/api/student-email/verify-provider').set(auth.headers).set('Cookie', auth.cookie);
    const providerFetch = vi.spyOn(globalThis, 'fetch');
    providerFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'success', message: 'someone-else@stu.upes.ac.in' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'success', message: 'student@stu.upes.ac.in' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await request(providerApp)
      .post('/api/student-email/check-availability')
      .set(auth.headers)
      .set('Cookie', auth.cookie)
      .send({ email: 'student@stu.upes.ac.in' })
      .expect(200);
    await providerRequest().send({ email: 'student@stu.upes.ac.in', accessToken: 'mismatched-provider-token-1234' }).expect(400);
    await providerRequest().send({ email: 'student@stu.upes.ac.in', accessToken: 'matching-provider-token-123456' }).expect(200);

    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(providerFetch).toHaveBeenLastCalledWith(
      providerConfig.MSG91_VERIFY_ACCESS_TOKEN_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { authkey: 'server-auth-key', 'content-type': 'application/json' },
        body: JSON.stringify({ 'access-token': 'matching-provider-token-123456' }),
      }),
    );
    const verifiedUser = (await ctx.db.select().from(schema.users).where(eq(schema.users.id, auth.user.id)))[0]!;
    expect(verifiedUser.studentEmailVerifiedAt).toBeInstanceOf(Date);
    expect(verifiedUser.studentEmailDomain).toBe('stu.upes.ac.in');
    const verifications = await ctx.db.select().from(schema.studentEmailVerifications).where(eq(schema.studentEmailVerifications.userId, auth.user.id));
    expect(verifications).toHaveLength(1);
    expect(verifications[0]!.otpHash).not.toContain('matching-provider-token-123456');
    expect(await ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.template, 'student-email-otp'))).toHaveLength(0);

    await providerRequest().send({ email: 'student@stu.upes.ac.in', accessToken: 'matching-provider-token-123456' }).expect(400);
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it('creates and privately tracks a public statutory grievance without storing contact in plaintext', async () => {
    const created = await request(ctx.app).post('/api/grievances').send({ email: 'affected@example.com', reason: 'NON_CONSENSUAL_INTIMATE_IMAGE', affectedPerson: true, targetUrl: 'https://uni.rocks/listing/unsafe', details: 'This URL contains intimate material published without my consent.' }).expect(201);
    expect(created.body.data.reference).toBeTruthy();
    expect(created.body.data.trackingSecret).toBeTruthy();
    const row = (await ctx.db.select().from(schema.reports))[0]!;
    expect(row.reporterEmailCiphertext).not.toContain('affected@example.com');
    const tracked = await request(ctx.app).post('/api/grievances/track').send({ reference: created.body.data.reference, secret: created.body.data.trackingSecret }).expect(200);
    expect(tracked.body.data.category).toBe('VICTIM_CONTENT');
  });

  it('blocks prohibited goods at submission after normalized term matching', async () => {
    const seller = await login(ctx.app, 'prohibited-seller');
    await verifyPhone(seller);
    await ctx.db.insert(schema.prohibitedTerms).values({ term: 'weapon', severity: 'BLOCK' });
    const listing = await createDraft(seller, ctx.category.id, { title: 'Used decorative weapon' });
    await uploadImage(seller, listing.id).then((response) => expect(response.status).toBe(200));
    const denied = await seller.agent.post(`/api/listings/${listing.id}/submit`).set(seller.headers).expect(400);
    expect(denied.body.error.code).toBe('PROHIBITED_LISTING');
  });

  it('closes an account immediately and schedules retention cleanup', async () => {
    const auth = await login(ctx.app, 'privacy-controls');
    await verifyPhone(auth);
    await auth.agent.delete('/api/account').set(auth.headers).send({ confirmation: 'DELETE MY ACCOUNT' }).expect(204);
    await auth.agent.get('/api/auth/session').expect(200).then((response) => expect(response.body.data).toBeNull());
    const row = (await ctx.db.select().from(schema.users))[0]!;
    expect(row.closedAt).toBeTruthy();
    expect(row.purgeAfter).toBeTruthy();
  });
});
