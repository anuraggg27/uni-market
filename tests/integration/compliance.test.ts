import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import * as schema from '../../apps/api/src/db/schema';
import { RetentionWorker } from '../../apps/api/src/services/retention';
import { GrievanceMonitor } from '../../apps/api/src/services/grievance-monitor';
import { createDraft, login, makeRole, setup, uploadImage, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx?.client.close();
});

describe('India compliance controls', () => {
  it('publishes contact and marketplace disclosures without operator or provider metadata', async () => {
    const result = await request(ctx.app).get('/api/compliance').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.transactionModel).toContain('does not provide payment processing');
    expect(result.body.data.ranking).toContain('three times favourites');
    expect(result.body.data.customerCareEmail).toBe('support@uni.rocks');
    expect(result.body.data.privacyEmail).toBe('privacy@uni.rocks');
    expect(result.body.data).not.toHaveProperty('operator');
    expect(result.body.data).not.toHaveProperty('policyVersion');
    expect(result.body.data).not.toHaveProperty('jurisdictionCity');
    expect(result.body.data).not.toHaveProperty('processors');
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
    const domains = await auth.agent.get('/api/academic-domains').expect(200);
    expect(domains.headers['cache-control']).toContain('private');
    expect(domains.body.data.map((entry: { institutionName: string }) => entry.institutionName)).toEqual(['Example Institute', 'UPES']);
    const upes = domains.body.data.find((entry: { domain: string }) => entry.domain === 'stu.upes.ac.in');
    await auth.agent.post('/api/onboarding/complete').set(auth.headers).send({ displayName: 'Eligible Student', avatarId: 'avatar-01', academicDomainId: upes.id, adultAttested: false, acceptTerms: true, acknowledgePrivacy: true, acceptCommunityRules: true, policyVersion: '2026-08-25' }).expect(400);
    await auth.agent.post('/api/onboarding/complete').set(auth.headers).send({ displayName: 'Eligible Student', avatarId: 'avatar-01', academicDomainId: upes.id, adultAttested: true, acceptTerms: true, acknowledgePrivacy: true, acceptCommunityRules: true, policyVersion: '2026-08-25' }).expect(200);
    const domain = await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'student@gmail.com' }).expect(400);
    expect(domain.body.error.code).toBe('ACADEMIC_DOMAIN_NOT_APPROVED');
    const mismatch = await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'student@students.example.edu' }).expect(400);
    expect(mismatch.body.error.code).toBe('STUDENT_EMAIL_DOMAIN_MISMATCH');
    await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'student@stu.upes.ac.in' }).expect(200);
    await auth.agent.post('/api/student-email/verify').set(auth.headers).send({ email: 'student@stu.upes.ac.in', code: '999999' }).expect(200);
  });

  it('clears student-email verification when the selected institution changes', async () => {
    const auth = await login(ctx.app, 'institution-change');
    await verifyPhone(auth);
    const domains = await auth.agent.get('/api/academic-domains').expect(200);
    const upes = domains.body.data.find((entry: { domain: string }) => entry.domain === 'stu.upes.ac.in');

    await auth.agent.patch('/api/auth/me').set(auth.headers).send({
      displayName: 'Institution Change',
      avatarId: 'avatar-02',
      academicDomainId: upes.id,
      campus: null,
      graduationYear: null,
    }).expect(200);

    const me = await auth.agent.get('/api/auth/me').expect(200);
    expect(me.body.data.institution).toBe('UPES');
    expect(me.body.data.studentEmailDomain).toBe('stu.upes.ac.in');
    expect(me.body.data.studentEmailMasked).toBeNull();
    expect(me.body.data.eligibility.studentEmailVerified).toBe(false);
    const oldDomain = await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: 'again@students.example.edu' }).expect(400);
    expect(oldDomain.body.error.code).toBe('STUDENT_EMAIL_DOMAIN_MISMATCH');
  });

  it('accepts a matching MSG91 student-email token once and never queues an SMTP OTP', async () => {
    const auth = await login(ctx.app, 'msg91-student-email');
    const domains = await auth.agent.get('/api/academic-domains').expect(200);
    const upes = domains.body.data.find((entry: { domain: string }) => entry.domain === 'stu.upes.ac.in');
    await auth.agent.post('/api/onboarding/complete').set(auth.headers).send({ displayName: 'MSG91 Student', avatarId: 'avatar-01', academicDomainId: upes.id, adultAttested: true, acceptTerms: true, acknowledgePrivacy: true, acceptCommunityRules: true, policyVersion: '2026-08-25' }).expect(200);
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
    const created = await request(ctx.app).post('/api/grievances').send({ email: 'affected@example.com', reason: 'NON_CONSENSUAL_INTIMATE_IMAGE', affectedPerson: true, targetUrl: 'http://localhost:5173/listing/unsafe', details: 'This URL contains intimate material published without my consent.' }).expect(201);
    expect(created.body.data.reference).toBeTruthy();
    expect(created.body.data.trackingSecret).toBeTruthy();
    const row = (await ctx.db.select().from(schema.reports))[0]!;
    expect(row.reporterEmailCiphertext).not.toContain('affected@example.com');
    expect(row.targetUrl).toBeNull();
    expect(row.details).toBeNull();
    expect(row.targetUrlCiphertext).not.toContain('localhost');
    expect(row.detailsCiphertext).not.toContain('intimate material');
    const queuedEmails = await ctx.db.select().from(schema.emailOutbox);
    expect(queuedEmails.map((job) => job.template).sort()).toEqual(['grievance-new-internal', 'grievance-received']);
    const tracked = await request(ctx.app).post('/api/grievances/track').send({ reference: created.body.data.reference, secret: created.body.data.trackingSecret }).expect(200);
    expect(tracked.body.data.category).toBe('VICTIM_CONTENT');
  });

  it('supports the complete grievance lifecycle with audited staff access and notifications', async () => {
    const created = await request(ctx.app).post('/api/grievances').send({ email: 'reporter@example.com', reason: 'OTHER', affectedPerson: true, targetUrl: 'http://localhost:5173/listing/reported', details: 'The listing and seller conduct need a factual review by the platform.' }).expect(201);
    const reference = created.body.data.reference as string;
    const secret = created.body.data.trackingSecret as string;
    const report = (await ctx.db.select().from(schema.reports))[0]!;

    await request(ctx.app).post(`/api/grievances/${reference}/messages`).send({ secret, message: 'Additional information from the reporter.' }).expect(201);
    const reporterMessage = (await ctx.db.select().from(schema.reportEvents).where(eq(schema.reportEvents.reportId, report.id))).find((event) => event.eventType === 'REPORTER_MESSAGE')!;
    expect(reporterMessage.publicMessage).toBeNull();
    expect(reporterMessage.publicMessageCiphertext).not.toContain('Additional information');

    const staff = await login(ctx.app, 'grievance-support');
    await makeRole(ctx.db, staff.user.id, 'SUPPORT_AGENT');
    const queue = await staff.agent.get('/api/admin/grievances').expect(200);
    expect(queue.body.data[0]).not.toHaveProperty('details');

    const detail = await staff.agent.get(`/api/admin/grievances/${report.id}`).expect(200);
    expect(detail.body.data.details).toContain('factual review');
    expect(detail.body.data.events.some((event: any) => event.type === 'REPORTER_MESSAGE')).toBe(true);
    expect((await ctx.db.select().from(schema.adminAuditLogs)).some((entry) => entry.action === 'VIEW_GRIEVANCE')).toBe(true);

    await staff.agent.post(`/api/admin/grievances/${report.id}/acknowledge`).set(staff.headers).expect(200);
    await staff.agent.post(`/api/admin/grievances/${report.id}/messages`).set(staff.headers).send({ publicMessage: 'We are reviewing the information you supplied.', internalReason: 'Reporter supplied relevant new facts.' }).expect(201);
    await staff.agent.post(`/api/admin/grievances/${report.id}/resolve`).set(staff.headers).send({ outcome: 'RESOLVED', publicResponse: 'The reported listing was reviewed and action was recorded.', internalReason: 'Completed review under the marketplace rules.' }).expect(200);

    const resolved = await request(ctx.app).post('/api/grievances/track').send({ reference, secret }).expect(200);
    expect(resolved.body.data.status).toBe('RESOLVED');
    expect(resolved.body.data.events.some((event: any) => event.message.includes('reviewing'))).toBe(true);
    const resolvedRow = (await ctx.db.select().from(schema.reports).where(eq(schema.reports.id, report.id)))[0]!;
    expect(resolvedRow.purgeAfter).toBeInstanceOf(Date);
    expect(resolvedRow.publicResponse).toBeNull();
    expect(resolvedRow.publicResponseCiphertext).not.toContain('reported listing');
    expect((await ctx.db.select().from(schema.adminAuditLogs)).some((entry) => entry.action === 'GRIEVANCE_ACKNOWLEDGED')).toBe(true);

    await request(ctx.app).post(`/api/grievances/${reference}/appeal`).send({ secret, reason: 'The decision did not address the additional evidence.' }).expect(201);
    const appealed = (await ctx.db.select().from(schema.reports).where(eq(schema.reports.id, report.id)))[0]!;
    expect(appealed.resolvedAt).toBeNull();
    expect(appealed.purgeAfter).toBeNull();
    expect(appealed.actionDueAt.getTime()).toBeGreaterThan(resolvedRow.actionDueAt.getTime());
    const appealedDetail = await staff.agent.get(`/api/admin/grievances/${report.id}`).expect(200);
    expect(appealedDetail.body.data.events.some((event: any) => event.internalMessage?.includes('additional evidence'))).toBe(true);

    const templates = (await ctx.db.select().from(schema.emailOutbox)).map((job) => job.template);
    expect(templates).toEqual(expect.arrayContaining(['grievance-received', 'grievance-new-internal', 'grievance-follow-up-internal', 'grievance-response', 'grievance-appeal-internal']));
  });

  it('rejects off-platform grievance links', async () => {
    const response = await request(ctx.app).post('/api/grievances').send({ email: 'reporter@example.com', reason: 'OTHER', affectedPerson: true, targetUrl: 'https://example.com/phishing', details: 'This complaint points away from the platform and must not reach staff.' }).expect(400);
    expect(response.body.error.fieldErrors.targetUrl).toContain('Enter a localhost link');
  });

  it('accepts a general grievance when there is no specific Uni Market URL', async () => {
    const created = await request(ctx.app).post('/api/grievances').send({ email: 'general@example.com', reason: 'OTHER', affectedPerson: false, targetUrl: '', details: 'This general complaint concerns the platform rather than one specific page.' }).expect(201);
    const report = (await ctx.db.select().from(schema.reports).where(eq(schema.reports.publicReference, created.body.data.reference)))[0]!;
    expect(report.targetType).toBe('PLATFORM');
    expect(report.targetUrlCiphertext).toBeNull();
  });

  it('erases expired grievance content unless a legal hold applies', async () => {
    await request(ctx.app).post('/api/grievances').send({ email: 'retention@example.com', reason: 'OTHER', affectedPerson: false, targetUrl: 'http://localhost:5173/listing/retention', details: 'This grievance is used to verify scheduled content erasure.' }).expect(201);
    const report = (await ctx.db.select().from(schema.reports))[0]!;
    await ctx.db.update(schema.reports).set({ status: 'RESOLVED', resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000), purgeAfter: new Date(Date.now() - 24 * 60 * 60_000) }).where(eq(schema.reports.id, report.id));

    const worker = new RetentionWorker(ctx.db, { ...ctx.config, RETENTION_MODE: 'enforce' }, { delete: vi.fn() } as any);
    await worker.runOnce();

    const purged = (await ctx.db.select().from(schema.reports).where(eq(schema.reports.id, report.id)))[0]!;
    expect(purged.reporterEmailCiphertext).toBeNull();
    expect(purged.targetUrlCiphertext).toBeNull();
    expect(purged.detailsCiphertext).toBeNull();
    expect(purged.purgeAfter).toBeNull();
    expect(await ctx.db.select().from(schema.reportEvents).where(eq(schema.reportEvents.reportId, report.id))).toHaveLength(0);
  });

  it('queues a deduplicated alert when an open grievance reaches its deadline', async () => {
    await request(ctx.app).post('/api/grievances').send({ email: 'deadline@example.com', reason: 'OTHER', affectedPerson: false, targetUrl: 'http://localhost:5173/listing/deadline', details: 'This grievance is used to verify operational deadline alerts.' }).expect(201);
    const report = (await ctx.db.select().from(schema.reports))[0]!;
    await ctx.db.update(schema.reports).set({ actionDueAt: new Date(Date.now() - 60_000) }).where(eq(schema.reports.id, report.id));
    const monitor = new GrievanceMonitor(ctx.db, ctx.config);
    await monitor.runOnce();
    await monitor.runOnce();
    const alerts = await ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.template, 'grievance-deadline-internal'));
    expect(alerts).toHaveLength(1);
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

  it('queues a closed account for deletion and requires explicit Google reactivation', async () => {
    const credential = 'privacy-controls'.padEnd(24, 'x');
    const auth = await login(ctx.app, 'privacy-controls');
    await verifyPhone(auth);
    await auth.agent.delete('/api/account').set(auth.headers).send({ confirmation: 'DELETE MY ACCOUNT' }).expect(204);
    await auth.agent.get('/api/auth/session').expect(200).then((response) => expect(response.body.data).toBeNull());
    const closed = (await ctx.db.select().from(schema.users))[0]!;
    expect(closed.closedAt).toBeTruthy();
    expect(closed.deletedAt).toBeTruthy();
    expect(closed.purgeAfter).toBeTruthy();
    expect(closed.onboardingComplete).toBe(true);

    const denied = await request(ctx.app).post('/api/auth/google').send({ credential }).expect(409);
    expect(denied.body.error.code).toBe('ACCOUNT_PENDING_DELETION');
    expect(denied.body.error.message).toBe('This account is closed and queued for deletion');
    expect(denied.body.error.details.purgeAfter).toBe(closed.purgeAfter?.toISOString());
    expect(denied.headers['set-cookie']).toBeUndefined();

    const reactivatedAgent = request.agent(ctx.app);
    const reactivated = await reactivatedAgent.post('/api/auth/google').send({ credential, reactivate: true }).expect(200);
    expect(reactivated.body.data).toEqual({ onboardingRequired: false, reactivated: true });
    await reactivatedAgent.get('/api/auth/session').expect(200).then((response) => expect(response.body.data?.id).toBe(auth.user.id));
    const reopened = (await ctx.db.select().from(schema.users))[0]!;
    expect(reopened.closedAt).toBeNull();
    expect(reopened.deletedAt).toBeNull();
    expect(reopened.purgeAfter).toBeNull();
  });
});
