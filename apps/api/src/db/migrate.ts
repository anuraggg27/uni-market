import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../config.js';

const config = loadConfig();
const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname;
if (config.DATABASE_URL.startsWith('pglite://')) {
  const path = config.DATABASE_URL.slice('pglite://'.length);
  const localPath = path === ':memory:' ? undefined : resolve(process.cwd(), path);
  if (localPath) mkdirSync(dirname(localPath), { recursive: true });
  const client = new PGlite(localPath);
  await migratePglite(drizzlePglite(client), { migrationsFolder }); await client.close();
} else {
  const client = postgres(config.DATABASE_URL, { max: 1 });
  await migratePostgres(drizzlePostgres(client), { migrationsFolder }); await client.end();
}
