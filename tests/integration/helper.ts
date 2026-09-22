import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import sharp from 'sharp';
import { resolve } from 'node:path';
import { createApp } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import * as schema from '../../apps/api/src/db/schema';
import type { GoogleIdentity, GoogleVerifier } from '../../apps/api/src/services/google';
import { AppError } from '../../apps/api/src/lib/errors';

class FakeGoogleVerifier implements GoogleVerifier {
  async verify(credential: string): Promise<GoogleIdentity> {
    if (credential.startsWith('invalid-')) throw new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google sign-in could not be verified');
    const marker = credential.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
    return { sub: `google-sub-${credential}`, email: `${marker}@${credential.includes('domain-b') ? 'example.org' : 'gmail.com'}`, emailVerified: true, name: `Student ${marker}` };
  }
}

export async function setup(options: { webIndexHtml?: string } = {}) {
  const client = new PGlite(); const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/api/drizzle') });
  const config = loadConfig({ NODE_ENV: 'test', APP_ENV: 'test', DEV_MODE: 'true', CLIENT_URL: 'http://localhost:5173', API_URL: 'http://localhost:4000', DATABASE_URL: 'pglite://:memory:', SESSION_SECRET: 'test-session-secret-at-least-32-chars', CSRF_SECRET: 'test-csrf-secret-at-least-32-chars', SMTP_FROM_EMAIL: 'test@example.com', R2_BUCKET_NAME: 'uni-market-test', R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com' });
  const app = createApp({ db, config, googleVerifier: new FakeGoogleVerifier(), ...options });
  await db.insert(schema.academicDomains).values([
    {
      domain: 'students.example.edu',
      institutionName: 'Example Institute',
      sourceUrl: 'https://students.example.edu',
    },
    {
      domain: 'stu.upes.ac.in',
      institutionName: 'UPES',
      sourceUrl: 'https://www.upes.ac.in/',
    },
  ]);
  const category = (await db.insert(schema.categories).values({ name: 'Books', slug: 'books' }).returning())[0]!;
  return { client, db, config, app, category };
}

export async function login(app: ReturnType<typeof createApp>, credential: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/google').send({ credential: credential.padEnd(24, 'x') });
  if (response.status !== 200) throw new Error(`login failed ${response.status}: ${JSON.stringify(response.body)}`);
  const me = await agent.get('/api/auth/me');
  const csrf = await agent.get('/api/auth/csrf');
  const setCookie = response.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { agent, user: me.body.data, csrf: csrf.body.data.csrfToken as string, cookie: String(cookie).split(';')[0], headers: { 'x-csrf-token': csrf.body.data.csrfToken as string } };
}

export async function verifyMarketplaceEligibility(auth: Awaited<ReturnType<typeof login>>) {
  const domains = await auth.agent.get('/api/academic-domains').expect(200);
  const academicDomain = domains.body.data.find((entry: { domain: string }) => entry.domain === 'students.example.edu');
  if (!academicDomain) throw new Error('Expected test academic domain');
  const onboarding = await auth.agent.post('/api/onboarding/complete').set(auth.headers).send({
    displayName: auth.user.displayName,
    avatarId: 'avatar-01',
    academicDomainId: academicDomain.id,
    campus: null,
    graduationYear: null,
    adultAttested: true,
    acceptTerms: true,
    acknowledgePrivacy: true,
    acceptCommunityRules: true,
    policyVersion: '2026-08-27',
  });
  const studentEmail = `${auth.user.id}@students.example.edu`;
  await auth.agent.post('/api/student-email/send').set(auth.headers).send({ email: studentEmail }).expect(200);
  await auth.agent.post('/api/student-email/verify').set(auth.headers).send({ email: studentEmail, code: '999999' }).expect(200);
  return onboarding;
}

export async function verifyPhone(auth: Awaited<ReturnType<typeof login>>, phone = '9876543210') {
  const onboarding = await verifyMarketplaceEligibility(auth);
  await auth.agent.post('/api/phone/send').set(auth.headers).send({ phone }).expect(200);
  await auth.agent.post('/api/phone/verify').set(auth.headers).send({ phone, code: '999999' }).expect(200);
  return onboarding;
}

export async function createDraft(auth: Awaited<ReturnType<typeof login>>, categoryId: string, overrides: Record<string, unknown> = {}) {
  const response = await auth.agent.post('/api/listings').set(auth.headers).send({ title: 'Linear algebra textbook', description: 'Barely used textbook with clean pages and no missing chapters.', categoryId, condition: 'GOOD', conditionExplanation: '', priceType: 'FIXED', exactPrice: 450, negotiable: true, location: 'Main campus library', brand: '', defects: '', meetupPoint: 'Library entrance', ownershipAttested: true, usedPhysicalGoodsAttested: true, accurateDescriptionAttested: true, sellerPolicyAccepted: true, ...overrides });
  if (response.status !== 201) throw new Error(`draft failed ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body.data;
}

export async function uploadImage(auth: Awaited<ReturnType<typeof login>>, listingId: string, content?: Buffer) {
  const buffer = content ?? await sharp({ create: { width: 640, height: 480, channels: 3, background: '#56806a' } }).jpeg().toBuffer();
  const presign = await auth.agent.post(`/api/uploads/listings/${listingId}/presign`).set(auth.headers).send({ mimeType: 'image/jpeg', byteSize: buffer.length }).expect(201);
  const url = new URL(presign.body.data.uploadUrl);
  await auth.agent.put(`${url.pathname}${url.search}`).set('content-type', 'image/jpeg').send(buffer).expect(204);
  return auth.agent.post(`/api/uploads/listings/${listingId}/finalize`).set(auth.headers).send({ imageId: presign.body.data.imageId });
}

export async function makeRole(db: any, userId: string, role: 'MODERATOR'|'SUPPORT_AGENT'|'SUPER_ADMIN') {
  await db.insert(schema.userRoles).values({ userId, role }).onConflictDoNothing();
  await db.update(schema.sessions).set({ staffVerifiedAt: new Date() }).where(eq(schema.sessions.userId, userId));
}

export async function refreshAuthRoles(db: any, auth: Awaited<ReturnType<typeof login>>) {
  const rawSessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, auth.user.id));
  expectExisting(rawSessions[0]);
}
function expectExisting(value: unknown): asserts value { if (!value) throw new Error('Expected seeded value'); }
