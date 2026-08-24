import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema';
import { OtpService } from '../../apps/api/src/services/otp';
import { login, setup, verifyPhone } from './helper';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async()=>{ctx=await setup();});afterEach(async()=>{vi.restoreAllMocks();await ctx?.client.close();});

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
  it('exposes development mode without leaking provider credentials',async()=>{const auth=await login(ctx.app,'phone-config');const response=await auth.agent.get('/api/phone/config').expect(200);expect(response.body.data).toEqual({provider:'development',otpLength:6,retryAfter:60});expect(JSON.stringify(response.body)).not.toContain('tokenAuth');});
  it('PHONE-02 and PHONE-07 verify normalized phone with single-use development OTP and no provider call',async()=>{const auth=await login(ctx.app,'phone-valid');await verifyPhone(auth).then((r)=>expect(r.status).toBe(200));const user=(await ctx.db.select().from(schema.users).where(eq(schema.users.id,auth.user.id)))[0];expect(user?.phoneE164).toBe('+919876543210');expect(user?.phoneVerifiedAt).toBeTruthy();const second=await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'999999'}).expect(400);expect(second.body.error.code).toBe('OTP_INVALID');});
  it('PHONE-03 locks after maximum incorrect attempts without exposing details',async()=>{const auth=await login(ctx.app,'phone-attempts');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(200);for(let i=0;i<5;i++){const response=await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'111111'}).expect(400);expect(response.body.error.message).toBe('The verification code could not be accepted');}const row=(await ctx.db.select().from(schema.phoneVerifications))[0];expect(row?.attempts).toBe(5);expect(row?.invalidatedAt).toBeTruthy();});
  it('PHONE-04 enforces resend cooldown',async()=>{const auth=await login(ctx.app,'phone-cooldown');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(200);await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'}).expect(429);});
  it('PHONE-05 rejects expired OTP',async()=>{const auth=await login(ctx.app,'phone-expiry');await auth.agent.post('/api/phone/send').set(auth.headers).send({phone:'9876543210'});await ctx.db.update(schema.phoneVerifications).set({expiresAt:new Date(Date.now()-1000)});await auth.agent.post('/api/phone/verify').set(auth.headers).send({phone:'9876543210',code:'999999'}).expect(400);});
  it('PHONE-06 rejects an unavailable phone before sending and still checks during verification',async()=>{const first=await login(ctx.app,'phone-owner-one');await verifyPhone(first);const second=await login(ctx.app,'phone-owner-two');const preflight=await second.agent.post('/api/phone/check-availability').set(second.headers).send({phone:'9876543210'}).expect(409);expect(preflight.body.error.code).toBe('PHONE_ALREADY_IN_USE');expect(preflight.body.error.message).toBe('This phone number is already being used by another account');await second.agent.post('/api/phone/send').set(second.headers).send({phone:'9876543210'});const response=await second.agent.post('/api/phone/verify').set(second.headers).send({phone:'9876543210',code:'999999'}).expect(409);expect(response.body.error.code).toBe('PHONE_ALREADY_IN_USE');});
  it('validates an MSG91 access token server-side and binds only the returned identifier',async()=>{
    const auth=await login(ctx.app,'msg91-provider-user');
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:'server-only-test-authkey'});
    const provider=vi.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({type:'success',message:'919111111111'}),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({type:'success',message:'919876543210'}),{status:200,headers:{'content-type':'application/json'}}));

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','mismatched-provider-token-value', 'test-ip-hash')).rejects.toMatchObject({code:'OTP_INVALID'});
    await service.verifyProviderToken(auth.user.id,'+919876543210','verified-provider-token-value','test-ip-hash');

    const user=(await ctx.db.select().from(schema.users).where(eq(schema.users.id,auth.user.id)))[0];
    const verification=(await ctx.db.select().from(schema.phoneVerifications).where(eq(schema.phoneVerifications.userId,auth.user.id)))[0];
    expect(user?.phoneE164).toBe('+919876543210');
    expect(user?.phoneVerifiedAt).toBeTruthy();
    expect(verification?.otpHash).not.toContain('verified-provider-token-value');
    expect(provider).toHaveBeenLastCalledWith(
      'https://api.msg91.com/api/v5/widget/verifyAccessToken',
      expect.objectContaining({
        method:'POST',
        headers:expect.objectContaining({authkey:'server-only-test-authkey'}),
        body:JSON.stringify({'access-token':'verified-provider-token-value'})
      })
    );
    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','verified-provider-token-value','test-ip-hash')).rejects.toMatchObject({code:'OTP_INVALID'});
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('MSG91 provider failure handling',()=>{
  it('rejects provider tokens in development mode without contacting MSG91',async()=>{
    const auth=await login(ctx.app,'msg91-development-mode');
    const provider=vi.spyOn(globalThis,'fetch');
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:true,MSG91_AUTH_KEY:'unused-auth-key'});

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','provider-token','test-ip-hash')).rejects.toMatchObject({
      status:400,
      code:'OTP_DEVELOPMENT_MODE'
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('reports unavailable configuration before spending a provider request',async()=>{
    const auth=await login(ctx.app,'msg91-missing-config');
    const provider=vi.spyOn(globalThis,'fetch');
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:undefined});

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','provider-token','test-ip-hash')).rejects.toMatchObject({
      status:503,
      code:'OTP_UNAVAILABLE'
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('maps provider network failures to a retryable service error',async()=>{
    const auth=await login(ctx.app,'msg91-network-failure');
    vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('provider connection reset'));
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:'server-auth-key'});

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','provider-token','test-ip-hash')).rejects.toMatchObject({
      status:503,
      code:'OTP_UNAVAILABLE',
      message:'Phone verification is temporarily unavailable'
    });
  });

  it.each([429,500,503])('maps MSG91 status %i to a retryable service error',async(status)=>{
    const auth=await login(ctx.app,`msg91-provider-${status}`);
    vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({type:'error',message:'provider unavailable'}),{
      status,
      headers:{'content-type':'application/json'}
    }));
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:'server-auth-key'});

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','provider-token','test-ip-hash')).rejects.toMatchObject({
      status:503,
      code:'OTP_UNAVAILABLE'
    });
  });

  it('does not accept a non-JSON provider response as proof of phone ownership',async()=>{
    const auth=await login(ctx.app,'msg91-invalid-response');
    vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('<html>bad gateway</html>',{
      status:400,
      headers:{'content-type':'text/html'}
    }));
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:'server-auth-key'});

    await expect(service.verifyProviderToken(auth.user.id,'+919876543210','provider-token','test-ip-hash')).rejects.toMatchObject({
      status:400,
      code:'OTP_INVALID',
      message:'The phone verification could not be accepted'
    });
  });

  it('maps a concurrent verified-phone uniqueness race to PHONE_ALREADY_IN_USE',async()=>{
    const owner=await login(ctx.app,'msg91-race-winner');
    const contender=await login(ctx.app,'msg91-race-contender');
    vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({type:'success',message:'919876543210'}),{
      status:200,
      headers:{'content-type':'application/json'}
    }));
    vi.spyOn(ctx.db,'transaction').mockImplementationOnce(async()=>{
      await ctx.db.update(schema.users).set({phoneE164:'+919876543210',phoneVerifiedAt:new Date()}).where(eq(schema.users.id,owner.user.id));
      throw Object.assign(new Error('duplicate verified phone'),{code:'23505'});
    });
    const service=new OtpService(ctx.db,{...ctx.config,DEV_MODE:false,MSG91_AUTH_KEY:'server-auth-key'});

    await expect(service.verifyProviderToken(contender.user.id,'+919876543210','provider-token-for-race-test','test-ip-hash')).rejects.toMatchObject({
      status:409,
      code:'PHONE_ALREADY_IN_USE',
      message:'This phone number is already being used by another account'
    });
  });
});
