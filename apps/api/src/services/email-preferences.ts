import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { emailOutbox, emailPreferences } from '../db/schema.js';

export type EmailPreferenceCategory =
  | 'listingUpdates'
  | 'transactionUpdates'
  | 'messageUpdates'
  | 'policyReminders';

export const defaultEmailPreferences = {
  enabled: true,
  listingUpdates: true,
  transactionUpdates: true,
  messageUpdates: true,
  policyReminders: true,
} as const;

export type EmailPreferenceValues = {
  enabled: boolean;
  listingUpdates: boolean;
  transactionUpdates: boolean;
  messageUpdates: boolean;
  policyReminders: boolean;
};

export function emailCategory(template: string): EmailPreferenceCategory | null {
  if (['listing_approved', 'listing_rejected', 'listing_removed'].includes(template)) return 'listingUpdates';
  if (['purchase-request', 'purchase-accepted', 'transaction-completed-buyer', 'transaction-completed-seller', 'transaction-cancelled'].includes(template)) return 'transactionUpdates';
  if (template === 'first-conversation-message') return 'messageUpdates';
  if (template === 'policy-reminder') return 'policyReminders';
  return null;
}

export function resolvedEmailPreferences(values?: Partial<EmailPreferenceValues> | null): EmailPreferenceValues {
  return {
    enabled: values?.enabled ?? defaultEmailPreferences.enabled,
    listingUpdates: values?.listingUpdates ?? defaultEmailPreferences.listingUpdates,
    transactionUpdates: values?.transactionUpdates ?? defaultEmailPreferences.transactionUpdates,
    messageUpdates: values?.messageUpdates ?? defaultEmailPreferences.messageUpdates,
    policyReminders: values?.policyReminders ?? defaultEmailPreferences.policyReminders,
  };
}

export function allowsEmail(values: Partial<EmailPreferenceValues> | null | undefined, category: EmailPreferenceCategory): boolean {
  const preferences = resolvedEmailPreferences(values);
  return preferences.enabled && preferences[category];
}

type EmailExecutor = Pick<Database, 'select' | 'insert'>;

export async function queueUserEmail(
  db: EmailExecutor,
  input: {
    recipientUserId: string;
    template: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<boolean> {
  const category = emailCategory(input.template);
  if (category) {
    const preferences = (await db.select().from(emailPreferences).where(eq(emailPreferences.userId, input.recipientUserId)).limit(1))[0];
    if (!allowsEmail(preferences, category)) return false;
  }

  await db.insert(emailOutbox).values(input).onConflictDoNothing();
  return true;
}
