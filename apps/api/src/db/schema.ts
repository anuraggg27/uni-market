import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['USER', 'SUPPORT_AGENT', 'MODERATOR', 'SUPER_ADMIN']);
export const moderationEnum = pgEnum('moderation_state', ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED']);
export const lifecycleEnum = pgEnum('lifecycle_state', ['DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'EXPIRED', 'WITHDRAWN']);
export const conditionEnum = pgEnum('product_condition', ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']);
export const priceTypeEnum = pgEnum('price_type', ['FIXED', 'RANGE', 'FREE']);
export const transactionEnum = pgEnum('transaction_status', ['REQUESTED', 'ACCEPTED', 'RESERVED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER', 'DISPUTED']);
export const supportStatusEnum = pgEnum('support_status', ['OPEN', 'ASSIGNED', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']);
export const reportStatusEnum = pgEnum('report_status', ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED']);
export const notificationTypeEnum = pgEnum('notification_type', ['LISTING_SUBMITTED', 'LISTING_APPROVED', 'LISTING_REJECTED', 'LISTING_REMOVED', 'NEW_CONVERSATION', 'NEW_MESSAGE', 'PURCHASE_REQUEST', 'REQUEST_ACCEPTED', 'LISTING_RESERVED', 'TRANSACTION_COMPLETED', 'REVIEW_RECEIVED', 'SUPPORT_RESPONSE', 'MODERATION_WARNING']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  institution: text('institution'),
  campus: text('campus'),
  graduationYear: integer('graduation_year'),
  phoneE164: text('phone_e164'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  fraudInvestigation: boolean('fraud_investigation').default(false).notNull(),
  completedSales: integer('completed_sales').default(0).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps
}, (table) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`), uniqueIndex('users_verified_phone_idx').on(table.phoneE164).where(sql`${table.phoneVerifiedAt} is not null`)]);

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').default('google').notNull(),
  providerSubject: text('provider_subject').notNull(),
  emailAtLogin: text('email_at_login').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex('oauth_provider_subject_idx').on(table.provider, table.providerSubject)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  csrfHash: text('csrf_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('sessions_user_idx').on(table.userId), index('sessions_expiry_idx').on(table.expiresAt)]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: roleEnum('role').notNull(),
  grantedBy: uuid('granted_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.userId, table.role] })]);

export const phoneVerifications = pgTable('phone_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  phoneE164: text('phone_e164').notNull(),
  otpHash: text('otp_hash').notNull(),
  providerSessionId: text('provider_session_id'),
  attempts: integer('attempts').default(0).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  ipHash: text('ip_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('phone_verifications_lookup_idx').on(table.userId, table.phoneE164, table.createdAt), index('phone_verifications_phone_sent_idx').on(table.phoneE164, table.sentAt)]);

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps
});

export const listings = pgTable('listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  sellerId: uuid('seller_id').references(() => users.id).notNull(),
  categoryId: uuid('category_id').references(() => categories.id).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  condition: conditionEnum('condition').notNull(),
  conditionExplanation: text('condition_explanation'),
  priceType: priceTypeEnum('price_type').notNull(),
  exactPrice: integer('exact_price'),
  minimumPrice: integer('minimum_price'),
  maximumPrice: integer('maximum_price'),
  negotiable: boolean('negotiable').default(false).notNull(),
  location: text('location').notNull(),
  brand: text('brand'),
  defects: text('defects'),
  meetupPoint: text('meetup_point'),
  moderationState: moderationEnum('moderation_state').default('PENDING').notNull(),
  lifecycleState: lifecycleEnum('lifecycle_state').default('DRAFT').notNull(),
  rejectionReason: text('rejection_reason'),
  requestedChanges: text('requested_changes'),
  reservedBuyerId: uuid('reserved_buyer_id').references(() => users.id),
  viewCount: integer('view_count').default(0).notNull(),
  favouriteCount: integer('favourite_count').default(0).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  soldAt: timestamp('sold_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps
}, (table) => [
  index('listings_public_idx').on(table.moderationState, table.lifecycleState, table.approvedAt),
  index('listings_category_idx').on(table.categoryId), index('listings_seller_idx').on(table.sellerId),
  index('listings_location_idx').on(table.location), index('listings_price_idx').on(table.exactPrice, table.minimumPrice, table.maximumPrice),
  check('listing_price_shape', sql`(${table.priceType} = 'FREE' and ${table.exactPrice} is null and ${table.minimumPrice} is null and ${table.maximumPrice} is null) or (${table.priceType} = 'FIXED' and ${table.exactPrice} is not null and ${table.minimumPrice} is null and ${table.maximumPrice} is null) or (${table.priceType} = 'RANGE' and ${table.exactPrice} is null and ${table.minimumPrice} is not null and ${table.maximumPrice} is not null and ${table.minimumPrice} <= ${table.maximumPrice})`)
]);

export const listingImages = pgTable('listing_images', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  tempKey: text('temp_key'),
  objectKey: text('object_key'),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  position: integer('position').notNull(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex('listing_image_position_idx').on(table.listingId, table.position), index('listing_images_owner_idx').on(table.ownerId)]);

export const favourites = pgTable('favourites', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.userId, table.listingId] })]);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => listings.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  sellerId: uuid('seller_id').references(() => users.id).notNull(),
  firstMessageEmailQueuedAt: timestamp('first_message_email_queued_at', { withTimezone: true }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex('conversation_identity_idx').on(table.listingId, table.buyerId, table.sellerId), check('conversation_not_self', sql`${table.buyerId} <> ${table.sellerId}`), index('conversation_buyer_idx').on(table.buyerId), index('conversation_seller_idx').on(table.sellerId)]);

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.conversationId, table.userId] })]);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  clientId: uuid('client_id').notNull(),
  body: text('body').notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex('message_dedupe_idx').on(table.senderId, table.clientId), index('messages_conversation_idx').on(table.conversationId, table.createdAt)]);

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => listings.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  sellerId: uuid('seller_id').references(() => users.id).notNull(),
  status: transactionEnum('status').default('REQUESTED').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  disputeReason: text('dispute_reason'),
  ...timestamps
}, (table) => [check('transaction_not_self', sql`${table.buyerId} <> ${table.sellerId}`), index('transactions_listing_idx').on(table.listingId, table.status), index('transactions_buyer_idx').on(table.buyerId), index('transactions_seller_idx').on(table.sellerId), uniqueIndex('one_active_reservation_idx').on(table.listingId).where(sql`${table.status} in ('RESERVED', 'HANDED_OVER')`)]);

export const reviews = pgTable('reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  transactionId: uuid('transaction_id').references(() => transactions.id).notNull(),
  reviewerId: uuid('reviewer_id').references(() => users.id).notNull(),
  revieweeId: uuid('reviewee_id').references(() => users.id).notNull(),
  rating: integer('rating').notNull(),
  text: text('text').notNull(),
  tags: text('tags').array().default(sql`'{}'::text[]`).notNull(),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenReason: text('hidden_reason'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex('review_once_idx').on(table.transactionId, table.reviewerId), check('review_not_self', sql`${table.reviewerId} <> ${table.revieweeId}`), check('review_rating_range', sql`${table.rating} between 1 and 5`), index('reviews_reviewee_idx').on(table.revieweeId, table.hiddenAt)]);

export const blocks = pgTable('blocks', {
  blockerId: uuid('blocker_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  blockedId: uuid('blocked_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] }), check('block_not_self', sql`${table.blockerId} <> ${table.blockedId}`)]);

export const reports = pgTable('reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reporterId: uuid('reporter_id').references(() => users.id).notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  conversationContextStart: timestamp('conversation_context_start', { withTimezone: true }),
  conversationContextEnd: timestamp('conversation_context_end', { withTimezone: true }),
  status: reportStatusEnum('status').default('OPEN').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps
}, (table) => [index('reports_queue_idx').on(table.status, table.createdAt), uniqueIndex('reports_dedupe_idx').on(table.reporterId, table.targetType, table.targetId, table.reason).where(sql`${table.status} in ('OPEN','INVESTIGATING')`)]);

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  href: text('href').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('notifications_user_read_idx').on(table.userId, table.readAt, table.createdAt)]);

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  category: text('category').notNull(),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  status: supportStatusEnum('status').default('OPEN').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  escalatedReportId: uuid('escalated_report_id').references(() => reports.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...timestamps
}, (table) => [index('support_queue_idx').on(table.status, table.assignedTo, table.createdAt), index('support_user_idx').on(table.userId)]);

export const supportMessages = pgTable('support_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').references(() => supportTickets.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  body: text('body').notNull(),
  internal: boolean('internal').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('support_messages_ticket_idx').on(table.ticketId, table.createdAt)]);

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminId: uuid('admin_id').references(() => users.id).notNull(),
  role: roleEnum('role').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  internalReason: text('internal_reason').notNull(),
  userVisibleReason: text('user_visible_reason'),
  requestId: text('request_id').notNull(),
  ipHash: text('ip_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('audit_created_idx').on(table.createdAt), index('audit_target_idx').on(table.targetType, table.targetId)]);

export const emailOutbox = pgTable('email_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  recipientUserId: uuid('recipient_user_id').references(() => users.id).notNull(),
  template: text('template').notNull(),
  payload: jsonb('payload').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('email_outbox_pending_idx').on(table.sentAt, table.availableAt)]);

export const prohibitedTerms = pgTable('prohibited_terms', {
  id: uuid('id').defaultRandom().primaryKey(),
  term: text('term').notNull().unique(),
  severity: text('severity').default('FLAG').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const moderationNotes = pgTable('moderation_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'cascade' }).notNull(),
  moderatorId: uuid('moderator_id').references(() => users.id).notNull(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
