import { describe, expect, it } from 'vitest';
import { analyticsDeviceType, normalizeAnalyticsRoute } from '../../apps/api/src/routes/analytics';

describe('privacy-safe analytics normalization', () => {
  it('groups dynamic marketplace URLs without retaining record identifiers', () => {
    expect(normalizeAnalyticsRoute('/marketplace/listing/53e1be8c-77fa-43b9-b03c-5cbc0a7a09c5')).toBe('/listing/:id');
    expect(normalizeAnalyticsRoute('/listing/53e1be8c-77fa-43b9-b03c-5cbc0a7a09c5/edit')).toBe('/listing/:id/edit');
    expect(normalizeAnalyticsRoute('/seller/53e1be8c-77fa-43b9-b03c-5cbc0a7a09c5')).toBe('/seller/:id');
    expect(normalizeAnalyticsRoute('/category/Books-And-Notes')).toBe('/category/books-and-notes');
    expect(normalizeAnalyticsRoute('/unexpected/private-value')).toBe('/not-found');
  });

  it('excludes the admin portal and classifies broad device types', () => {
    expect(normalizeAnalyticsRoute('/admin')).toBeNull();
    expect(normalizeAnalyticsRoute('/marketplace/admin/users')).toBeNull();
    expect(analyticsDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile')).toBe('mobile');
    expect(analyticsDeviceType('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('tablet');
    expect(analyticsDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/152')).toBe('desktop');
    expect(analyticsDeviceType('')).toBe('unknown');
  });
});
