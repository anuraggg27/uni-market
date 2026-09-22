import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { publicApi } from '../api';

const STORAGE_KEY = 'uni-market:analytics-id';
const LEGACY_STORAGE_KEY = 'uni-market:daily-analytics-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let fallbackVisitorId: string | undefined;
let lastTracked: { path: string; at: number } | undefined;
let landingTracked = false;

export function analyticsVisitorId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_PATTERN.test(stored)) return stored;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as { id?: unknown } | null;
    if (typeof legacy?.id === 'string' && UUID_PATTERN.test(legacy.id)) {
      localStorage.setItem(STORAGE_KEY, legacy.id);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      fallbackVisitorId = legacy.id;
      return legacy.id;
    }
  } catch {
    // Storage can be unavailable in hardened browser modes; use one identifier until this page closes.
  }
  if (fallbackVisitorId) return fallbackVisitorId;
  fallbackVisitorId = crypto.randomUUID();
  try { localStorage.setItem(STORAGE_KEY, fallbackVisitorId); } catch { /* use the in-memory value */ }
  return fallbackVisitorId;
}

export function analyticsTrackingAllowed(): boolean {
  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack !== '1' && !privacyNavigator.globalPrivacyControl;
}

function externalReferrerHost(): string | null {
  if (!document.referrer) return null;
  try {
    const host = new URL(document.referrer).hostname;
    return host === window.location.hostname ? window.location.hostname : host;
  } catch {
    return null;
  }
}

export function AnalyticsTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!analyticsTrackingAllowed() || pathname === '/admin' || pathname.startsWith('/admin/')) return;
    const now = Date.now();
    if (lastTracked?.path === pathname && now - lastTracked.at < 1_500) return;
    lastTracked = { path: pathname, at: now };
    const landing = !landingTracked;
    landingTracked = true;
    void publicApi('/api/analytics/page-view', {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({
        path: pathname,
        visitorId: analyticsVisitorId(),
        landing,
        referrerHost: landing ? externalReferrerHost() : null,
      }),
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
