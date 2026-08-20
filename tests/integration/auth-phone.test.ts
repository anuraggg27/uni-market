import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { login, setup, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async()=>{ctx=await setup();});afterEach(async()=>ctx?.client.close());

describe('authentication acceptance',()=>{
  it('returns an anonymous session without emitting an expected browser error',async()=>{
    const request=(await import('supertest')).default;
    const response=await request(ctx.app).get('/api/auth/session').expect(200);
    expect(response.body.data).toBeNull();expect(response.headers['cache-control']).toBe('no-store');
  });
  it('AUTH-01 guest browsing returns approved active listings without private seller data',async()=>{
    const seller=(await ctx.db.insert(schema.users).values({email:'seller@example.com',displayName:'Seller',phoneE164:'+919876543210',phoneVerifiedAt:new Date()}).returning())[0]!;
    await ctx.db.insert(schema.listings).values({sellerId:seller.id,categoryId:ctx.category.id,title:'Approved calculator',description:'A working scientific calculator in good condition.',condition:'GOOD',priceType:'FIXED',exactPrice:500,negotiable:false,location:'Campus gate',moderationState:'APPROVED',lifecycleState:'ACTIVE',approvedAt:new Date()});
    const response=await (await import('supertest')).default(ctx.app).get('/api/listings').expect(200);
    expect(response.body.data).toHaveLength(1);expect(JSON.stringify(response.body)).not.toContain(seller.email);expect(JSON.stringify(response.body)).not.toContain(seller.phoneE164);
  });
  it('AUTH-02 Google registration creates a secure session and requests name confirmation',async()=>{
    const auth=await login(ctx.app,'new-student-google');
    expect(auth.user.onboardingComplete).toBe(false);
    const accounts=await ctx.db.select().from(schema.oauthAccounts);const sessions=await ctx.db.select().from(schema.sessions);
    expect(accounts).toHaveLength(1);expect(sessions).toHaveLength(1);expect(sessions[0]?.tokenHash).not.toContain('campus_session');
  });
  it('AUTH-03 accepts verified Google accounts from unrelated email domains',async()=>{
    await login(ctx.app,'student-domain-a');await login(ctx.app,'student-domain-b');
    expect(await ctx.db.select().from(schema.users)).toHaveLength(2);
  });
  it('AUTH-04 repeated sign-in with the same Google sub reuses the user',async()=>{
    await login(ctx.app,'repeat-identity');await login(ctx.app,'repeat-identity');
    expect(await ctx.db.select().from(schema.users)).toHaveLength(1);
  });
  it('AUTH-05 invalid Google credentials fail safely',async()=>{
    const request=(await import('supertest')).default;
    const response=await request(ctx.app).post('/api/auth/google').send({credential:'invalid-google-credential-long'}).expect(401);
    expect(response.body.error.code).toBe('INVALID_GOOGLE_CREDENTIAL');expect(JSON.stringify(response.body)).not.toContain('token');
  });
  it('AUTH-06 logout revokes the session and clears access',async()=>{
    const auth=await login(ctx.app,'logout-user');await auth.agent.post('/api/auth/logout').set(auth.headers).expect(204);await auth.agent.get('/api/auth/me').expect(401);
    const row=(await ctx.db.select().from(schema.sessions))[0];expect(row?.revokedAt).toBeTruthy();
  });
});

describe('phone verification acceptance',()=>{
  it('PHONE-01 blocks protected actions before verification',async()=>{const auth=await login(ctx.app,'unverified-user');const response=await auth.agent.post('/api/listings').set(auth.headers).send({}).expect(403);expect(response.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');});
  it('PHONE-02 and PHONE-07 verify normalized phone with single-use development OTP and no provider call',async()=>{const auth=await login(ctx.app,'phone-valid');await verifyPhone(auth).then((r)=>expect(r.status).toBe(200));const user=(await ctx.db.select().from(schema.users).where(eq(schema.users.id,auth.user.id)))[0];expect(user?.phoneE164).toBe('+919876543210');expect(user?.phoneVerifiedAt).toBeTruthy();const second=await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'999999'}).expect(400);expect(second.body.error.code).toBe('OTP_INVALID');});
  it('PHONE-03 locks after maximum incorrect attempts without exposing details',async()=>{const auth=await login(ctx.app,'phone-attempts');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(200);for(let i=0;i<5;i++){const response=await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'111111'}).expect(400);expect(response.body.error.message).toBe('The verification code could not be accepted');}const row=(await ctx.db.select().from(schema.phoneVerifications))[0];expect(row?.attempts).toBe(5);expect(row?.invalidatedAt).toBeTruthy();});
  it('PHONE-04 enforces resend cooldown',async()=>{const auth=await login(ctx.app,'phone-cooldown');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(200);await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(429);});
  it('PHONE-05 rejects expired OTP',async()=>{const auth=await login(ctx.app,'phone-expiry');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'});await ctx.db.update(schema.phoneVerifications).set({expiresAt:new Date(Date.now()-1000)});await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'999999'}).expect(400);});
  it('PHONE-06 prevents a verified phone from being attached to another account',async()=>{const first=await login(ctx.app,'phone-owner-one');await verifyPhone(first);const second=await login(ctx.app,'phone-owner-two');await second.agent.post('/api/phone/send').set(second.headers).send({phone:'9876543210'});const response=await second.agent.post('/api/phone/verify').set(second.headers).send({phone:'9876543210',code:'999999'}).expect(400);expect(response.body.error.message).toBe('The verification code could not be accepted');});
});
