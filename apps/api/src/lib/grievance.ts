import { keyedHash, randomToken, safeEqual } from './crypto.js';

export type GrievanceCategory =
  | 'GENERAL'
  | 'UNLAWFUL_CONTENT'
  | 'VICTIM_CONTENT'
  | 'CHILD_SAFETY'
  | 'COURT_GOVERNMENT_ORDER';

export function grievanceCategoryForReason(reason: string): GrievanceCategory {
  if (reason === 'COURT_GOVERNMENT_ORDER') return 'COURT_GOVERNMENT_ORDER';
  if (reason === 'CSAM_CHILD_SAFETY') return 'CHILD_SAFETY';
  if (['NON_CONSENSUAL_INTIMATE_IMAGE', 'SEXUAL_IMPERSONATION'].includes(reason)) return 'VICTIM_CONTENT';
  if (['UNLAWFUL_CONTENT', 'CREDIBLE_THREAT', 'DOXXING', 'IDENTITY_IMPERSONATION', 'INTELLECTUAL_PROPERTY', 'PRIVACY', 'PROHIBITED_ITEM'].includes(reason)) return 'UNLAWFUL_CONTENT';
  return 'GENERAL';
}

export function grievanceClock(reason: string, now = new Date()) {
  const category = grievanceCategoryForReason(reason);
  const actionHours = category === 'COURT_GOVERNMENT_ORDER' ? 3 : category === 'VICTIM_CONTENT' || category === 'CHILD_SAFETY' ? 2 : category === 'UNLAWFUL_CONTENT' ? 36 : 7 * 24;
  return {
    category,
    priority: category === 'GENERAL' ? 'STANDARD' : category === 'UNLAWFUL_CONTENT' ? 'HIGH' : 'URGENT',
    acknowledgeDueAt: new Date(now.getTime() + 24 * 60 * 60_000),
    actionDueAt: new Date(now.getTime() + actionHours * 60 * 60_000),
  };
}

export function grievanceTracking(secret: string) {
  const publicReference = `UM-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomToken(6).toUpperCase()}`;
  const trackingSecret = randomToken(24);
  return { publicReference, trackingSecret, trackingHash: keyedHash(`${publicReference}:${trackingSecret}`, secret) };
}

export function verifyTracking(publicReference: string, trackingSecret: string, expected: string, secret: string): boolean {
  return safeEqual(keyedHash(`${publicReference}:${trackingSecret}`, secret), expected);
}
