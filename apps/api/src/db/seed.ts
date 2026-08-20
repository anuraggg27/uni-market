import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';
import { categories, prohibitedTerms, userRoles, users } from './schema.js';

const config = loadConfig();
const { db, close } = createDatabase(config);

const categorySeeds = [
  ['Books & notes', 'books-notes'], ['Electronics', 'electronics'], ['Furniture', 'furniture'],
  ['Cycles & transport', 'cycles-transport'], ['Clothing', 'clothing'], ['Sports', 'sports'],
  ['Room essentials', 'room-essentials'], ['Other', 'other']
] as const;
for (const [index, [name, slug]] of categorySeeds.entries()) await db.insert(categories).values({ name, slug, sortOrder: index }).onConflictDoNothing();

const terms = ['exam leak', 'student id for sale', 'vape', 'cigarette', 'weapon', 'prescription medicine', 'counterfeit'] as const;
for (const term of terms) await db.insert(prohibitedTerms).values({ term }).onConflictDoNothing();

for (const email of config.BOOTSTRAP_ADMIN_EMAILS.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
  const user = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
  if (user) await db.insert(userRoles).values({ userId: user.id, role: 'SUPER_ADMIN' }).onConflictDoNothing();
}
await close();
