// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsTrackingAllowed, analyticsVisitorId } from '../../apps/web/src/components/AnalyticsTracker';

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

  it('reuses an anonymous identifier across dates so reloads remain one visitor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const first = analyticsVisitorId();
    expect(analyticsVisitorId()).toBe(first);
    vi.setSystemTime(new Date('2026-09-23T00:00:01.000Z'));
    expect(analyticsVisitorId()).toBe(first);
  });

  it('migrates the current daily identifier without counting a new browser', () => {
    const legacyId = '11111111-1111-4111-8111-111111111111';
    localStorage.setItem('uni-market:daily-analytics-id', JSON.stringify({ day: '2026-09-22', id: legacyId }));
    expect(analyticsVisitorId()).toBe(legacyId);
    expect(localStorage.getItem('uni-market:analytics-id')).toBe(legacyId);
    expect(localStorage.getItem('uni-market:daily-analytics-id')).toBeNull();
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
