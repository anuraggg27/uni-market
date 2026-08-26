const STORAGE_KEY = 'uni-market:pending-contact:v1';
const LEGACY_PURCHASE_KEY = 'uni-market:pending-purchase:v1';
const MAX_AGE_MS = 15 * 60_000;

export type PendingContactIntent = {
  listingId: string;
  returnTo: string;
  createdAt: number;
};

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

function clearLegacyPurchase(): void {
  storage()?.removeItem(LEGACY_PURCHASE_KEY);
}

export function savePendingContact(listingId: string): PendingContactIntent {
  clearLegacyPurchase();
  const intent = { listingId, returnTo: `/listing/${listingId}`, createdAt: Date.now() };
  storage()?.setItem(STORAGE_KEY, JSON.stringify(intent));
  return intent;
}

export function pendingContact(): PendingContactIntent | null {
  clearLegacyPurchase();
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingContactIntent>;
    if (typeof parsed.listingId !== 'string' || typeof parsed.returnTo !== 'string' || typeof parsed.createdAt !== 'number' || Date.now() - parsed.createdAt > MAX_AGE_MS || parsed.createdAt > Date.now() + 60_000) {
      clearPendingContact();
      return null;
    }
    return parsed as PendingContactIntent;
  } catch {
    clearPendingContact();
    return null;
  }
}

export function consumePendingContact(listingId: string): boolean {
  const intent = pendingContact();
  if (!intent || intent.listingId !== listingId) return false;
  clearPendingContact();
  return true;
}

export function clearPendingContact(): void {
  storage()?.removeItem(STORAGE_KEY);
}
