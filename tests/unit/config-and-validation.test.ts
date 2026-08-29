import { describe, expect, it } from 'vitest';
import { listingInputSchema } from '@campus-market/shared';
import { loadConfig } from '../../apps/api/src/config';
import { maskPhone, sha256 } from '../../apps/api/src/lib/crypto';

describe('security configuration and shared validation', () => {
  it('PHONE-08 refuses production startup with DEV_MODE=true', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_MODE: 'true' })).toThrow(/DEV_MODE must be false in production/);
  });
  it('LIST-07 rejects an invalid price range and exclusive price shapes', () => {
    const result = listingInputSchema.safeParse({ title: 'A valid title', description: 'A sufficiently descriptive product description', categoryId: crypto.randomUUID(), condition: 'GOOD', priceType: 'RANGE', minimumPrice: 500, maximumPrice: 100, exactPrice: 200, negotiable: true, location: 'Main campus' });
    expect(result.success).toBe(false);
  });
  it('explains the listing description minimum', () => {
    const result = listingInputSchema.safeParse({
      title: 'A valid title',
      description: 'Too short',
      categoryId: crypto.randomUUID(),
      condition: 'GOOD',
      priceType: 'FIXED',
      exactPrice: 200,
      negotiable: true,
      location: 'Main campus',
      ownershipAttested: true,
      usedPhysicalGoodsAttested: true,
      accurateDescriptionAttested: true,
      sellerPolicyAccepted: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['description'],
          message: 'Minimum 10 characters required',
        }),
      );
    }
  });
  it('requires condition explanations for FAIR and POOR products', () => {
    expect(listingInputSchema.safeParse({ title: 'Used chair', description: 'A sufficiently descriptive product description', categoryId: crypto.randomUUID(), condition: 'FAIR', priceType: 'FREE', negotiable: false, location: 'Main campus' }).success).toBe(false);
  });
  it('PHONE-09 privacy helpers do not expose full phone numbers or secrets', () => {
    expect(maskPhone('+919876543210')).toBe('+91******210');
    expect(sha256('secret-value')).not.toContain('secret-value');
  });
});
