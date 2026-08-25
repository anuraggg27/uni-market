import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';
import { encryptText } from '../lib/crypto.js';

export async function queueDirectEmail(
  db: Database,
  config: AppConfig,
  input: { recipientEmail: string; template: string; payload: Record<string, unknown>; dedupeKey: string },
): Promise<void> {
  await db.insert(emailOutbox).values({
    recipientEmailCiphertext: encryptText(input.recipientEmail, config.DATA_ENCRYPTION_KEY),
    template: input.template,
    payload: {},
    encryptedPayload: encryptText(JSON.stringify(input.payload), config.DATA_ENCRYPTION_KEY),
    dedupeKey: input.dedupeKey,
  }).onConflictDoNothing();
}
