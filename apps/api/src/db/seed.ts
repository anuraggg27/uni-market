import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';
import { academicDomains, categories, prohibitedTerms, serviceProviderReviews, userRoles, users } from './schema.js';

const config = loadConfig();
const { db, close } = createDatabase(config);

const categorySeeds = [
  ['Books & notes', 'books-notes'], ['Electronics', 'electronics'], ['Furniture', 'furniture'],
  ['Cycles & transport', 'cycles-transport'], ['Clothing', 'clothing'], ['Sports', 'sports'],
  ['Room essentials', 'room-essentials'], ['Other', 'other']
] as const;
for (const [index, [name, slug]] of categorySeeds.entries()) await db.insert(categories).values({ name, slug, sortOrder: index }).onConflictDoNothing();

await db.insert(academicDomains).values({
  domain: 'stu.upes.ac.in',
  institutionName: 'UPES',
  sourceUrl: 'https://www.upes.ac.in/',
  allowSubdomains: false,
  active: true,
}).onConflictDoUpdate({
  target: academicDomains.domain,
  set: {
    institutionName: 'UPES',
    sourceUrl: 'https://www.upes.ac.in/',
    allowSubdomains: false,
    active: true,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  },
});

const terms = [
  ['exam leak', 'BLOCK'], ['student id for sale', 'BLOCK'], ['aadhaar for sale', 'BLOCK'], ['passport for sale', 'BLOCK'],
  ['vape', 'BLOCK'], ['e cigarette', 'BLOCK'], ['cigarette', 'BLOCK'], ['tobacco', 'BLOCK'],
  ['prescription medicine', 'BLOCK'], ['narcotic', 'BLOCK'], ['cannabis', 'BLOCK'], ['weed', 'FLAG'],
  ['firearm', 'BLOCK'], ['ammunition', 'BLOCK'], ['explosive', 'BLOCK'], ['weapon', 'BLOCK'], ['weapons', 'BLOCK'], ['fireworks', 'BLOCK'],
  ['counterfeit', 'BLOCK'], ['fake branded', 'BLOCK'], ['stolen', 'BLOCK'], ['recalled product', 'FLAG'],
  ['event ticket', 'BLOCK'], ['gift card', 'BLOCK'], ['account for sale', 'BLOCK'], ['password', 'BLOCK'],
  ['assignment service', 'BLOCK'], ['write my exam', 'BLOCK'], ['answer key', 'BLOCK'], ['digital download', 'BLOCK'], ['online service', 'FLAG'],
  ['alcohol', 'BLOCK'], ['liquor', 'BLOCK'], ['wildlife product', 'BLOCK'], ['sim card', 'BLOCK'], ['bank account', 'BLOCK'],
  ['government id', 'BLOCK'], ['personal data', 'BLOCK'], ['intimate image', 'BLOCK'], ['sexual service', 'BLOCK'],
] as const;
for (const [term, severity] of terms) await db.insert(prohibitedTerms).values({ term, severity }).onConflictDoUpdate({ target: prohibitedTerms.term, set: { severity, active: true } });

const providers = [
  { providerKey: 'google', displayName: 'Google', purpose: 'Identity sign-in', dataCategories: ['OAuth identity', 'login email'], region: 'According to operator contract', privacyUrl: 'https://policies.google.com/privacy' },
  { providerKey: 'msg91', displayName: 'MSG91', purpose: 'Phone and student-email verification', dataCategories: ['phone number', 'student email', 'verification events'], region: 'According to operator contract', privacyUrl: 'https://msg91.com/privacy-policy' },
  { providerKey: 'smtp', displayName: config.EMAIL_PROVIDER_NAME, purpose: 'Non-OTP transactional email', dataCategories: ['recipient email', 'delivery metadata'], region: config.EMAIL_PROVIDER_REGION, privacyUrl: 'https://example.invalid/provider-review-required' },
  { providerKey: 'neon', displayName: 'Neon', purpose: 'Application database', dataCategories: ['account and marketplace records'], region: config.DATABASE_REGION, privacyUrl: 'https://neon.tech/privacy-policy' },
  { providerKey: 'cloudflare', displayName: 'Cloudflare', purpose: 'Object storage, bot protection and delivery security', dataCategories: ['listing images', 'network data', 'challenge data'], region: config.OBJECT_STORAGE_REGION, privacyUrl: 'https://www.cloudflare.com/privacypolicy/' },
] satisfies Array<{ providerKey: string; displayName: string; purpose: string; dataCategories: string[]; region: string; privacyUrl: string }>;
for (const provider of providers) await db.insert(serviceProviderReviews).values(provider).onConflictDoNothing();

for (const email of config.BOOTSTRAP_ADMIN_EMAILS.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
  const user = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
  if (user) await db.insert(userRoles).values({ userId: user.id, role: 'SUPER_ADMIN' }).onConflictDoNothing();
}
await close();
