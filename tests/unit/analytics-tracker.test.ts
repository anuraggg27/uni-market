// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsTrackingAllowed, dailyAnalyticsVisitorId } from '../../apps/web/src/components/AnalyticsTracker';

describe('browser analytics identity', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
  });

  it('reuses an anonymous identifier only for the current UTC day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const first = dailyAnalyticsVisitorId();
    expect(dailyAnalyticsVisitorId()).toBe(first);
    vi.setSystemTime(new Date('2026-09-23T00:00:01.000Z'));
    expect(dailyAnalyticsVisitorId()).not.toBe(first);
  });

  it('honours Do Not Track and Global Privacy Control', () => {
    expect(analyticsTrackingAllowed()).toBe(true);
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    expect(analyticsTrackingAllowed()).toBe(false);
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    expect(analyticsTrackingAllowed()).toBe(false);
  });
});
