import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { publicApi } from '../api';

const STORAGE_KEY = 'uni-market:daily-analytics-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let fallbackVisitor: { day: string; id: string } | undefined;
let lastTracked: { path: string; at: number } | undefined;
let landingTracked = false;

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailyAnalyticsVisitorId(now = new Date()): string {
  const day = utcDay(now);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { day?: unknown; id?: unknown } | null;
    if (stored?.day === day && typeof stored.id === 'string' && UUID_PATTERN.test(stored.id)) return stored.id;
  } catch {
    // Storage can be unavailable in hardened browser modes; the in-memory fallback still avoids duplicate route counts.
  }
  if (fallbackVisitor?.day === day) return fallbackVisitor.id;
  const record = { day, id: crypto.randomUUID() };
  fallbackVisitor = record;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* use the in-memory value */ }
  return record.id;
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
        visitorId: dailyAnalyticsVisitorId(),
        landing,
        referrerHost: landing ? externalReferrerHost() : null,
      }),
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
