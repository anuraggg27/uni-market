import { z } from 'zod';
export * from './seo.js';

export const roles = ['USER', 'SUPPORT_AGENT', 'MODERATOR', 'SUPER_ADMIN'] as const;
export const moderationStates = ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'] as const;
export const lifecycleStates = ['DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'EXPIRED', 'WITHDRAWN'] as const;
export const conditions = ['LIKE_NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export const priceTypes = ['FIXED', 'RANGE', 'FREE'] as const;
export const transactionStatuses = ['REQUESTED', 'ACCEPTED', 'RESERVED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER', 'DISPUTED'] as const;
export const supportStatuses = ['OPEN', 'ASSIGNED', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
export const reportReasons = ['CSAM_CHILD_SAFETY', 'NON_CONSENSUAL_INTIMATE_IMAGE', 'SEXUAL_IMPERSONATION', 'CREDIBLE_THREAT', 'DOXXING', 'IDENTITY_IMPERSONATION', 'EXPLICIT_CONTENT', 'SCAM', 'STOLEN_PRODUCT', 'COUNTERFEIT_PRODUCT', 'PROHIBITED_ITEM', 'UNLAWFUL_CONTENT', 'INTELLECTUAL_PROPERTY', 'PRIVACY', 'MISLEADING_INFORMATION', 'HARASSMENT', 'SPAM', 'DUPLICATE_LISTING', 'ALREADY_SOLD', 'WRONG_CATEGORY', 'UNSAFE_MEETUP', 'ACADEMIC_MISCONDUCT', 'COURT_GOVERNMENT_ORDER', 'OTHER'] as const;

export const currentPolicyVersion = '2026-08-27';
export const requiredOnboardingPolicies = ['TERMS', 'PRIVACY', 'COMMUNITY_RULES'] as const;
export const avatarAchievementIds = ['FIRST_LISTING', 'FIRST_PURCHASE'] as const;
export type AvatarAchievementId = typeof avatarAchievementIds[number];
export const avatarIds = [
  'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05',
  'avatar-06', 'avatar-07', 'avatar-08', 'avatar-09', 'avatar-10',
  'avatar-11', 'avatar-12', 'avatar-13', 'avatar-14', 'avatar-15',
  'avatar-16', 'avatar-17', 'avatar-18', 'avatar-19', 'avatar-20',
  'unlock_listing_female', 'unlock_listing_male',
  'unlock_purchase_female', 'unlock_purchase_male',
] as const;
export type AvatarId = typeof avatarIds[number];
export type AvatarConfig = {
  id: AvatarId;
  name: string;
  src: string;
  achievement?: AvatarAchievementId;
  unlockRequirement?: string;
};
export const avatars: readonly AvatarConfig[] = [
  { id: 'avatar-01', name: 'Avatar 01', src: 'avatars/avatar-01.webp' },
  { id: 'avatar-02', name: 'Avatar 02', src: 'avatars/avatar-02.webp' },
  { id: 'avatar-03', name: 'Avatar 03', src: 'avatars/avatar-03.webp' },
  { id: 'avatar-04', name: 'Avatar 04', src: 'avatars/avatar-04.webp' },
  { id: 'avatar-05', name: 'Avatar 05', src: 'avatars/avatar-05.webp' },
  { id: 'avatar-06', name: 'Avatar 06', src: 'avatars/avatar-06.webp' },
  { id: 'avatar-07', name: 'Avatar 07', src: 'avatars/avatar-07.webp' },
  { id: 'avatar-08', name: 'Avatar 08', src: 'avatars/avatar-08.webp' },
  { id: 'avatar-09', name: 'Avatar 09', src: 'avatars/avatar-09.webp' },
  { id: 'avatar-10', name: 'Avatar 10', src: 'avatars/avatar-10.webp' },
  { id: 'avatar-11', name: 'Avatar 11', src: 'avatars/avatar-11.webp' },
  { id: 'avatar-12', name: 'Avatar 12', src: 'avatars/avatar-12.webp' },
  { id: 'avatar-13', name: 'Avatar 13', src: 'avatars/avatar-13.webp' },
  { id: 'avatar-14', name: 'Avatar 14', src: 'avatars/avatar-14.webp' },
  { id: 'avatar-15', name: 'Avatar 15', src: 'avatars/avatar-15.webp' },
  { id: 'avatar-16', name: 'Avatar 16', src: 'avatars/avatar-16.webp' },
  { id: 'avatar-17', name: 'Avatar 17', src: 'avatars/avatar-17.webp' },
  { id: 'avatar-18', name: 'Avatar 18', src: 'avatars/avatar-18.webp' },
  { id: 'avatar-19', name: 'Avatar 19', src: 'avatars/avatar-19.webp' },
  { id: 'avatar-20', name: 'Avatar 20', src: 'avatars/avatar-20.webp' },
  { id: 'unlock_listing_female', name: 'First listing reward 1', src: 'avatars/unlock-listing-female.webp', achievement: 'FIRST_LISTING', unlockRequirement: 'Create your first listing to unlock' },
  { id: 'unlock_listing_male', name: 'First listing reward 2', src: 'avatars/unlock-listing-male.webp', achievement: 'FIRST_LISTING', unlockRequirement: 'Create your first listing to unlock' },
  { id: 'unlock_purchase_female', name: 'First purchase reward 1', src: 'avatars/unlock-purchase-female.webp', achievement: 'FIRST_PURCHASE', unlockRequirement: 'Complete your first purchase to unlock' },
  { id: 'unlock_purchase_male', name: 'First purchase reward 2', src: 'avatars/unlock-purchase-male.webp', achievement: 'FIRST_PURCHASE', unlockRequirement: 'Complete your first purchase to unlock' },
];
export const avatarIdSchema = z.enum(avatarIds);
export const avatarAchievementIdSchema = z.enum(avatarAchievementIds);
export const defaultAvatarId: AvatarId = 'avatar-01';

export const idSchema = z.string().uuid();
export const phoneSchema = z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number');

const listingPriceSchema = z.number()
  .int({ error: 'Enter a price in whole rupees' })
  .min(1, { error: 'Price must be at least ₹1. Choose Free for a giveaway.' })
  .max(10_000_000, { error: 'Price must not exceed ₹1,00,00,000' })
  .nullable().optional();

export const listingInputSchema = z.object({
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().min(10, { error: 'Minimum 10 characters required' }).max(5000),
  categoryId: idSchema,
  condition: z.enum(conditions),
  conditionExplanation: z.string().trim().max(1000).optional().default(''),
  priceType: z.enum(priceTypes),
  exactPrice: listingPriceSchema,
  minimumPrice: listingPriceSchema,
  maximumPrice: listingPriceSchema,
  negotiable: z.boolean().default(false),
  location: z.string().trim().min(2).max(120),
  brand: z.string().trim().max(100).optional().default(''),
  defects: z.string().trim().max(1500).optional().default(''),
  meetupPoint: z.string().trim().max(160).optional().default(''),
  ownershipAttested: z.literal(true, { error: 'Confirm that you own or may lawfully sell this item' }),
  usedPhysicalGoodsAttested: z.literal(true, { error: 'Confirm that this is a used physical product' }),
  accurateDescriptionAttested: z.literal(true, { error: 'Confirm that the listing is accurate' }),
  sellerPolicyAccepted: z.literal(true, { error: 'Accept the seller policy' })
}).superRefine((value, context) => {
  if (['FAIR', 'POOR'].includes(value.condition) && value.conditionExplanation.length < 10) {
    context.addIssue({ code: 'custom', path: ['conditionExplanation'], message: 'Explain the condition in at least 10 characters' });
  }
  if (value.priceType === 'FIXED' && !value.exactPrice) {
    context.addIssue({ code: 'custom', path: ['exactPrice'], message: 'Enter the fixed price' });
  }
  if (value.priceType === 'RANGE') {
    if (!value.minimumPrice || !value.maximumPrice || value.minimumPrice > value.maximumPrice) {
      context.addIssue({ code: 'custom', path: ['minimumPrice'], message: 'Minimum price must not exceed maximum price' });
    }
  }
});

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  clientId: z.string().uuid(),
  safetyConfirmationToken: z.string().max(500).optional()
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(2).max(1000),
  tags: z.array(z.enum(['PRODUCT_AS_DESCRIBED', 'RESPONSIVE', 'SMOOTH_TRANSACTION', 'SAFE_MEETUP', 'LATE_MEETUP', 'INCORRECT_DESCRIPTION', 'BUYER_NO_SHOW', 'SELLER_NO_SHOW'])).max(4).default([])
});


export type ListingInput = z.infer<typeof listingInputSchema>;
export type Role = typeof roles[number];
export type TransactionStatus = typeof transactionStatuses[number];

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; fieldErrors?: Record<string, string[]> };
}
