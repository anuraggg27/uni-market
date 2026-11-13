import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { conversations, emailOutbox, messages } from '../../apps/api/src/db/schema';

it('upgrades existing 0014 data additively and replays 0015 through Drizzle without duplicate migration state', async () => {
  const source = resolve('apps/api/drizzle');
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
  const last = journal.entries.at(-1);
  expect(last).toMatchObject({ idx: 15, tag: '0015_unread_message_reminders' });
  const scratchRoot = resolve(tmpdir());
  const scratch = await mkdtemp(join(scratchRoot, 'uni-market-migration-audit-'));
  if (!resolve(scratch).startsWith(`${scratchRoot}${sep}uni-market-migration-audit-`)) throw new Error('Unexpected scratch path');
  const client = new PGlite();
  try {
    await mkdir(join(scratch, 'meta'));
    const previousEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15);
    await writeFile(join(scratch, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previousEntries }));
    await Promise.all(previousEntries.map((entry: { tag: string }) => copyFile(join(source, `${entry.tag}.sql`), join(scratch, `${entry.tag}.sql`))));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: scratch });

    const sellerId = randomUUID(); const buyerId = randomUUID(); const categoryId = randomUUID();
    const listingId = randomUUID(); const conversationId = randomUUID(); const messageId = randomUUID(); const outboxId = randomUUID();
    await client.query('insert into users (id, email, display_name) values ($1, $2, $3), ($4, $5, $6)', [sellerId, 'seller@example.test', 'Seller', buyerId, 'buyer@example.test', 'Buyer']);
    await client.query('insert into categories (id, name, slug) values ($1, $2, $3)', [categoryId, 'Audit fixture', 'audit-fixture']);
    await client.query("insert into listings (id, seller_id, category_id, title, description, condition, price_type, location) values ($1, $2, $3, 'Original listing', 'Original description', 'GOOD', 'FREE', 'Campus')", [listingId, sellerId, categoryId]);
    await client.query('insert into conversations (id, listing_id, buyer_id, seller_id) values ($1, $2, $3, $4)', [conversationId, listingId, buyerId, sellerId]);
    await client.query("insert into messages (id, conversation_id, sender_id, client_id, body) values ($1, $2, $3, $4, 'Original unread message')", [messageId, conversationId, buyerId, randomUUID()]);
    await client.query("insert into email_outbox (id, recipient_user_id, template, payload, dedupe_key) values ($1, $2, 'first-conversation-message', '{}', 'original-first-message')", [outboxId, sellerId]);
    const beforeMessages = await client.query('select * from messages');
    const beforeOutbox = await client.query('select id, recipient_user_id, template, payload, dedupe_key, attempts, sent_at from email_outbox');

    await migrate(db, { migrationsFolder: source });
    const history = await client.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations order by created_at');
    expect(history.rows).toHaveLength(journal.entries.length);
    expect(history.rows.at(-1)?.hash).toBe(readMigrationFiles({ migrationsFolder: source }).at(-1)!.hash);
    expect(Number(history.rows.at(-1)?.created_at)).toBe(last.when);
    await migrate(db, { migrationsFolder: source });
    expect((await client.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at')).rows).toEqual(history.rows);
    expect((await client.query('select * from messages')).rows).toEqual(beforeMessages.rows);
    expect((await client.query('select id, recipient_user_id, template, payload, dedupe_key, attempts, sent_at from email_outbox')).rows).toEqual(beforeOutbox.rows);
    expect((await client.query('select last_unread_reminder_through_at, last_unread_reminder_sent_at from conversations')).rows).toEqual([{ last_unread_reminder_through_at: null, last_unread_reminder_sent_at: null }]);
    expect((await client.query('select reminder_conversation_id, last_attempt_at from email_outbox')).rows).toEqual([{ reminder_conversation_id: null, last_attempt_at: null }]);

    const current = JSON.parse(await readFile(join(source, 'meta/0015_snapshot.json'), 'utf8'));
    const previous = JSON.parse(await readFile(join(source, 'meta/0014_snapshot.json'), 'utf8'));
    expect(current.prevId).toBe(previous.id);
    for (const table of [conversations, messages, emailOutbox]) {
      const tableConfig = getTableConfig(table);
      const snapshot = current.tables[`public.${tableConfig.name}`];
      expect(Object.keys(snapshot.columns).sort()).toEqual(tableConfig.columns.map(column => column.name).sort());
      for (const column of tableConfig.columns) {
        expect(snapshot.columns[column.name]).toMatchObject({ type: column.getSQLType(), notNull: column.notNull });
      }
    }
    const indexes = await client.query<{ indexname: string }>("select indexname from pg_indexes where indexname in ('email_outbox_pending_reminder_idx', 'messages_unread_conversation_idx')");
    expect(indexes.rows.map(row => row.indexname).sort()).toEqual(['email_outbox_pending_reminder_idx', 'messages_unread_conversation_idx']);
  } finally {
    await client.close();
    // Restrict recursive cleanup to the exact task-created temporary directory.
    await rm(scratch, { recursive: true });
  }
});
