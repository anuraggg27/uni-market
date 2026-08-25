import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';
import { encryptText } from '../lib/crypto.js';

type DirectEmailInput = {
  recipientEmail: string;
  template: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

export function directEmailJob(config: AppConfig, input: DirectEmailInput) {
  return {
    recipientEmailCiphertext: encryptText(input.recipientEmail, config.DATA_ENCRYPTION_KEY),
    template: input.template,
    payload: {},
    encryptedPayload: encryptText(JSON.stringify(input.payload), config.DATA_ENCRYPTION_KEY),
    dedupeKey: input.dedupeKey,
  };
}

export async function queueDirectEmail(
  db: Database,
  config: AppConfig,
  input: DirectEmailInput,
): Promise<void> {
  await db.insert(emailOutbox).values(directEmailJob(config, input)).onConflictDoNothing();
}
