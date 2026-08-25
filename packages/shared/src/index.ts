import { z } from 'zod';

export const roles = ['USER', 'SUPPORT_AGENT', 'MODERATOR', 'SUPER_ADMIN'] as const;
export const moderationStates = ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'] as const;
export const lifecycleStates = ['DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'EXPIRED', 'WITHDRAWN'] as const;
export const conditions = ['LIKE_NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export const priceTypes = ['FIXED', 'RANGE', 'FREE'] as const;
export const transactionStatuses = ['REQUESTED', 'ACCEPTED', 'RESERVED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER', 'DISPUTED'] as const;
export const supportStatuses = ['OPEN', 'ASSIGNED', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
export const reportReasons = ['CSAM_CHILD_SAFETY', 'NON_CONSENSUAL_INTIMATE_IMAGE', 'SEXUAL_IMPERSONATION', 'CREDIBLE_THREAT', 'DOXXING', 'IDENTITY_IMPERSONATION', 'EXPLICIT_CONTENT', 'SCAM', 'STOLEN_PRODUCT', 'COUNTERFEIT_PRODUCT', 'PROHIBITED_ITEM', 'UNLAWFUL_CONTENT', 'INTELLECTUAL_PROPERTY', 'PRIVACY', 'MISLEADING_INFORMATION', 'HARASSMENT', 'SPAM', 'DUPLICATE_LISTING', 'ALREADY_SOLD', 'WRONG_CATEGORY', 'UNSAFE_MEETUP', 'ACADEMIC_MISCONDUCT', 'COURT_GOVERNMENT_ORDER', 'OTHER'] as const;

export const currentPolicyVersion = '2026-08-25';
export const requiredOnboardingPolicies = ['TERMS', 'PRIVACY', 'COMMUNITY_RULES'] as const;
export const syntheticStatuses = ['UNKNOWN', 'NOT_SYNTHETIC', 'SYNTHETIC_OR_MATERIALLY_ALTERED'] as const;

export const idSchema = z.string().uuid();
export const phoneSchema = z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number');

export const listingInputSchema = z.object({
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().min(10).max(5000),
  categoryId: idSchema,
  condition: z.enum(conditions),
  conditionExplanation: z.string().trim().max(1000).optional().default(''),
  priceType: z.enum(priceTypes),
  exactPrice: z.number().int().min(1).max(10_000_000).nullable().optional(),
  minimumPrice: z.number().int().min(1).max(10_000_000).nullable().optional(),
  maximumPrice: z.number().int().min(1).max(10_000_000).nullable().optional(),
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

export const safetyReminder = 'Inspect the product before paying, meet in a safe public location and never share an OTP or sensitive financial information.';

export type ListingInput = z.infer<typeof listingInputSchema>;
export type Role = typeof roles[number];
export type TransactionStatus = typeof transactionStatuses[number];

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; fieldErrors?: Record<string, string[]> };
}
