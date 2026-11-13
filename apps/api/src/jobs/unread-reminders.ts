import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { UnreadReminderJob } from '../services/unread-reminders.js';
import { parseArgs } from 'node:util';
import { z } from 'zod';

let connection: ReturnType<typeof createDatabase> | undefined;
let exitCode = 0;
try {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, 'queue-only': { type: 'boolean' }, 'conversation-id': { type: 'string' } }, strict: true, allowPositionals: false });
  const conversationId = values['conversation-id'] === undefined ? undefined : z.uuid().parse(values['conversation-id']);
  const config = loadConfig();
  connection = createDatabase(config);
  const result = await new UnreadReminderJob(connection.db, config).runOnce(undefined, {
    dryRun: values['dry-run'] ?? false, queueOnly: values['queue-only'] ?? false,
    ...(conversationId ? { conversationId } : {}),
  });
  if (result.failed) exitCode = 1;
} catch {
  logger.error({ event: 'unread_reminders_aborted' }, 'Unread reminder job aborted; durable jobs will be retried on the next scheduled run');
  exitCode = 1;
} finally {
  try { await connection?.close(); }
  catch {
    logger.error({ event: 'unread_reminders_cleanup_failed' }, 'Unread reminder database cleanup failed');
    exitCode = 1;
  }
}
// PGlite's WASM shutdown can reset process.exitCode. Apply the task result after
// cleanup so both local and production runners report failures reliably.
process.exitCode = exitCode;
