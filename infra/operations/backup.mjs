import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { decryptFile, encryptFile, hashFile } from './backup-crypto.mjs';

const requiredTables = ['public.users', 'public.listings', 'public.transactions', 'public.email_outbox', 'drizzle.__drizzle_migrations'];

export function sourceEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A PostgreSQL backup source is required');
  if (url.hostname.includes('-pooler.')) throw new Error('Use the direct Neon endpoint, not the transaction pooler, for consistent snapshots');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const ssl = url.searchParams.get('sslmode') ?? (local ? 'disable' : 'verify-full');
  if (!local && !['require', 'verify-ca', 'verify-full'].includes(ssl)) throw new Error('Remote backups require TLS');
  if (!url.pathname.slice(1) || !url.username) throw new Error('Backup source must name a database and user');
  return {
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    // PostgreSQL requires verify-full when using the system CA store. Strengthen
    // provider URLs that say sslmode=require instead of disabling verification.
    PGSSLMODE: local ? ssl : 'verify-full', ...(!local ? { PGSSLROOTCERT: 'system' } : {}), PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'uni-market-readonly-backup',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=600000',
  };
}

function run(command, args, environment) {
  return new Promise((resolveRun, reject) => {
    // No shell, connection strings in argv, inherited secrets or raw database errors in logs.
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...environment },
      stdio: ['ignore', 'ignore', 'ignore'], timeout: 10 * 60_000,
    });
    child.on('error', () => reject(new Error(`${command} could not start`)));
    child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} failed; private database diagnostics were not logged`)));
  });
}

async function tableCounts(sql) {
  const tables = await sql`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, tablename`;
  const counts = {};
  for (const table of tables) {
    const [row] = await sql`SELECT count(*)::text AS count FROM ${sql(`${table.schemaname}.${table.tablename}`)}`;
    counts[`${table.schemaname}.${table.tablename}`] = row.count;
  }
  return counts;
}

function assertInventory(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) || requiredTables.some((name) => !(name in counts)) ||
      Object.values(counts).some((value) => typeof value !== 'string' || !/^\d+$/.test(value))) throw new Error('Backup does not contain the expected application tables');
}

export function restoreEnvironment(env) {
  if (env.BACKUP_RESTORE_ISOLATED !== 'true' || !env.BACKUP_RESTORE_PASSWORD) throw new Error('An explicitly isolated local restore database is required');
  const port = env.BACKUP_RESTORE_PORT ?? '5432';
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid isolated restore port');
  // Never accept a caller-supplied remote destination, database name or source URL here.
  return {
    PGHOST: '127.0.0.1', PGPORT: port, PGDATABASE: 'uni_restore_check', PGUSER: 'postgres',
    PGPASSWORD: env.BACKUP_RESTORE_PASSWORD, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'uni-market-isolated-restore', PGOPTIONS: '-c statement_timeout=600000',
  };
}

function connect(pg) {
  return postgres({ host: pg.PGHOST, port: Number(pg.PGPORT), username: pg.PGUSER, password: pg.PGPASSWORD,
    database: pg.PGDATABASE, ssl: pg.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
    max: 1, connect_timeout: 15, onnotice: () => undefined,
  });
}

export async function runBackup(env = process.env, verifyOnly = false) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.BACKUP_ENCRYPTION_KEY ?? '')) throw new Error('Set BACKUP_ENCRYPTION_KEY before creating backups');
  const destination = restoreEnvironment(env);
  const restore = connect(destination);
  const temporary = await mkdtemp(join(tmpdir(), 'uni-market-backup-'));
  let source;
  try {
    const existing = await tableCounts(restore);
    const [{ count: otherObjects }] = await restore`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'`;
    if (Object.keys(existing).length || otherObjects) throw new Error('Restore destination must be empty; existing data will never be overwritten');
    const directory = resolve(verifyOnly ? env.BACKUP_INPUT_DIR || '' : env.BACKUP_OUTPUT_DIR || '');
    if (!(verifyOnly ? env.BACKUP_INPUT_DIR : env.BACKUP_OUTPUT_DIR)) throw new Error('Provide an explicit encrypted backup directory');
    const encryptedDump = join(directory, 'database.dump.enc');
    const encryptedManifest = join(directory, 'manifest.json.enc');
    if (!verifyOnly) {
      const sourceEnv = sourceEnvironment(env.BACKUP_DATABASE_URL);
      if (sourceEnv.PGHOST === destination.PGHOST && sourceEnv.PGPORT === destination.PGPORT && sourceEnv.PGDATABASE === destination.PGDATABASE) throw new Error('Source and restore destination must differ');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await readdir(directory)).length) throw new Error('Backup output directory must be empty');
      source = connect(sourceEnv);
      const dump = join(temporary, 'source.dump');
      const manifest = await source.begin('isolation level repeatable read read only', async (sql) => {
        await sql`SET LOCAL statement_timeout = '600000ms'`;
        const [{ snapshot, version }] = await sql`SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version`;
        const counts = await tableCounts(sql);
        assertInventory(counts);
        await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=drizzle', '--lock-wait-timeout=30000', `--snapshot=${snapshot}`, `--file=${dump}`], sourceEnv);
        return { version: 1, createdAt: new Date().toISOString(), postgresVersion: version, commit: env.GITHUB_SHA ?? 'local', tables: counts, dumpSha256: await hashFile(dump) };
      });
      const manifestFile = join(temporary, 'source-manifest.json');
      await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
      await encryptFile(dump, encryptedDump, env.BACKUP_ENCRYPTION_KEY);
      await encryptFile(manifestFile, encryptedManifest, env.BACKUP_ENCRYPTION_KEY);
    }
    // Exercise the exact encrypted artifacts that will be retained, not the plaintext source dump.
    const restoredDump = join(temporary, 'authenticated.dump');
    const restoredManifest = join(temporary, 'authenticated-manifest.json');
    await decryptFile(encryptedManifest, restoredManifest, env.BACKUP_ENCRYPTION_KEY);
    const manifest = JSON.parse(await readFile(restoredManifest, 'utf8'));
    if (manifest.version !== 1) throw new Error('Unsupported backup manifest');
    assertInventory(manifest.tables);
    await decryptFile(encryptedDump, restoredDump, env.BACKUP_ENCRYPTION_KEY);
    if (await hashFile(restoredDump) !== manifest.dumpSha256) throw new Error('Backup files do not belong to the same snapshot');
    // A schema-selected dump includes CREATE SCHEMA public, which already exists
    // in a fresh PostgreSQL database. Reuse that empty schema; never DROP it or
    // ignore arbitrary restore errors. All tables, indexes and constraints stay.
    const restoreList = join(temporary, 'restore.list');
    await run('pg_restore', ['--list', `--file=${restoreList}`, restoredDump], destination);
    const [{ exists: publicExists }] = await restore`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS exists`;
    if (publicExists) {
      const entries = (await readFile(restoreList, 'utf8')).split('\n');
      await writeFile(restoreList, entries.map((line) => /^\d+; \d+ \d+ SCHEMA - public(?: |$)/.test(line) ? `; ${line}` : line).join('\n'), { mode: 0o600 });
    }
    await run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', `--use-list=${restoreList}`, '--dbname=uni_restore_check', restoredDump], destination);
    const actual = await tableCounts(restore);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables)) throw new Error('Restored table counts differ from the backup snapshot');
    const report = { verified: true, snapshotAt: manifest.createdAt, verifiedAt: new Date().toISOString(), tablesVerified: Object.keys(actual).length, sourceCommit: manifest.commit };
    console.info(JSON.stringify(report));
    return report;
  } finally {
    await Promise.allSettled([source?.end({ timeout: 5 }), restore.end({ timeout: 5 })]);
    // Only the unique scratch directory created by this invocation; encrypted outputs are retained.
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const verifyOnly = process.argv.includes('--verify-existing');
    if (verifyOnly && process.argv.includes('--upload-r2')) throw new Error('A recovery drill cannot publish a new backup');
    let uploadR2;
    if (process.argv.includes('--upload-r2')) {
      const { uploadR2Backup, r2BackupConfiguration, backupPrefix } = await import('./r2-backups.mjs');
      r2BackupConfiguration(process.env);
      backupPrefix(process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
      uploadR2 = uploadR2Backup;
    }
    const report = await runBackup(process.env, verifyOnly);
    if (uploadR2) await uploadR2(process.env, process.env.BACKUP_OUTPUT_DIR, report);
  })().catch(() => {
    // Driver errors can contain connection details or row values. Do not emit their messages.
    console.error('Backup, restore or R2 upload failed. Check configuration and provider dashboards; private diagnostics were not logged. No production data was modified.');
    process.exitCode = 1;
  });
}
