import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

export function createDatabase(config: AppConfig): { db: Database; close: () => Promise<void> } {
  if (config.DATABASE_URL.startsWith('pglite://')) {
    const path = config.DATABASE_URL.slice('pglite://'.length) || ':memory:';
    const localPath = path === ':memory:' ? undefined : resolve(process.cwd(), path);
    if (localPath) mkdirSync(dirname(localPath), { recursive: true });
    const client = new PGlite(localPath);
    return { db: drizzlePglite(client, { schema }), close: () => client.close() };
  }
  const client = postgres(config.DATABASE_URL, { max: 12, prepare: true, idle_timeout: 20 });
  return { db: drizzlePostgres(client, { schema }) as unknown as Database, close: () => client.end() };
}
