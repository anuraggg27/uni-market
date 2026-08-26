const STORAGE_KEY = 'uni-market:pending-purchase:v1';
const MAX_AGE_MS = 15 * 60_000;

export type PendingPurchaseIntent = {
  listingId: string;
  returnTo: string;
  createdAt: number;
};

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function savePendingPurchase(listingId: string): PendingPurchaseIntent {
  const intent = { listingId, returnTo: `/listing/${listingId}`, createdAt: Date.now() };
  storage()?.setItem(STORAGE_KEY, JSON.stringify(intent));
  return intent;
}

export function pendingPurchase(): PendingPurchaseIntent | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPurchaseIntent>;
    if (typeof parsed.listingId !== 'string' || typeof parsed.returnTo !== 'string' || typeof parsed.createdAt !== 'number' || Date.now() - parsed.createdAt > MAX_AGE_MS || parsed.createdAt > Date.now() + 60_000) {
      clearPendingPurchase();
      return null;
    }
    return parsed as PendingPurchaseIntent;
  } catch {
    clearPendingPurchase();
    return null;
  }
}

export function consumePendingPurchase(listingId: string): boolean {
  const intent = pendingPurchase();
  if (!intent || intent.listingId !== listingId) return false;
  clearPendingPurchase();
  return true;
}

export function clearPendingPurchase(): void {
  storage()?.removeItem(STORAGE_KEY);
}
