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
  studentEmailCiphertext: text('student_email_ciphertext'),
  studentEmailHash: text('student_email_hash'),
  studentEmailDomain: text('student_email_domain'),
  studentEmailVerifiedAt: timestamp('student_email_verified_at', { withTimezone: true }),
  studentEmailExpiresAt: timestamp('student_email_expires_at', { withTimezone: true }),
  adultAttestedAt: timestamp('adult_attested_at', { withTimezone: true }),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  fraudInvestigation: boolean('fraud_investigation').default(false).notNull(),
  completedSales: integer('completed_sales').default(0).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  policyReminderSentAt: timestamp('policy_reminder_sent_at', { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`),
  uniqueIndex('users_verified_phone_idx').on(table.phoneE164).where(sql`${table.phoneVerifiedAt} is not null`),
  uniqueIndex('users_verified_student_email_idx').on(table.studentEmailHash).where(sql`${table.studentEmailVerifiedAt} is not null`),
  index('users_purge_idx').on(table.purgeAfter)
]);

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
  staffVerifiedAt: timestamp('staff_verified_at', { withTimezone: true }),
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

export const academicDomains = pgTable('academic_domains', {
  id: uuid('id').defaultRandom().primaryKey(),
  domain: text('domain').notNull().unique(),
  institutionName: text('institution_name').notNull(),
  sourceUrl: text('source_url').notNull(),
  allowSubdomains: boolean('allow_subdomains').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, (table) => [index('academic_domains_active_idx').on(table.active, table.domain)]);

export const studentEmailVerifications = pgTable('student_email_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  academicDomainId: uuid('academic_domain_id').references(() => academicDomains.id).notNull(),
  emailCiphertext: text('email_ciphertext').notNull(),
  emailHash: text('email_hash').notNull(),
  otpHash: text('otp_hash').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  ipHash: text('ip_hash').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('student_email_verifications_user_idx').on(table.userId, table.createdAt),
  index('student_email_verifications_hash_idx').on(table.emailHash, table.sentAt)
]);

export const policyAcceptances = pgTable('policy_acceptances', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  policy: text('policy').notNull(),
  version: text('version').notNull(),
  locale: text('locale').default('en-IN').notNull(),
  source: text('source').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex('policy_acceptance_once_idx').on(table.userId, table.policy, table.version),
  index('policy_acceptance_user_idx').on(table.userId, table.acceptedAt)
]);

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
  sellerAttestedAt: timestamp('seller_attested_at', { withTimezone: true }),
  sellerPolicyVersion: text('seller_policy_version'),
  moderationRiskCodes: text('moderation_risk_codes').array().default(sql`'{}'::text[]`).notNull(),
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
  syntheticStatus: text('synthetic_status').default('UNKNOWN').notNull(),
  syntheticDeclaredAt: timestamp('synthetic_declared_at', { withTimezone: true }),
  provenanceId: uuid('provenance_id').defaultRandom().notNull(),
  sourceSha256: text('source_sha256'),
  sourceProvenanceDetected: boolean('source_provenance_detected').default(false).notNull(),
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
  exchangeCodeVersion: integer('exchange_code_version').default(1).notNull(),
  exchangeCodeAttempts: integer('exchange_code_attempts').default(0).notNull(),
  exchangeCodeIssuedAt: timestamp('exchange_code_issued_at', { withTimezone: true }),
  exchangeCodeLockedAt: timestamp('exchange_code_locked_at', { withTimezone: true }),
  exchangeCodeUsedAt: timestamp('exchange_code_used_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  disputeReason: text('dispute_reason'),
  ...timestamps
}, (table) => [check('transaction_not_self', sql`${table.buyerId} <> ${table.sellerId}`), check('exchange_code_version_positive', sql`${table.exchangeCodeVersion} >= 1`), check('exchange_code_attempts_range', sql`${table.exchangeCodeAttempts} between 0 and 5`), index('transactions_listing_idx').on(table.listingId, table.status), index('transactions_buyer_idx').on(table.buyerId), index('transactions_seller_idx').on(table.sellerId), uniqueIndex('one_active_reservation_idx').on(table.listingId).where(sql`${table.status} in ('RESERVED', 'HANDED_OVER')`)]);

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
  reporterId: uuid('reporter_id').references(() => users.id),
  reporterEmailCiphertext: text('reporter_email_ciphertext'),
  publicReference: text('public_reference').notNull().unique(),
  trackingHash: text('tracking_hash').notNull(),
  category: text('category').notNull(),
  priority: text('priority').default('STANDARD').notNull(),
  affectedPerson: boolean('affected_person').default(false).notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  targetUrl: text('target_url'),
  targetUrlCiphertext: text('target_url_ciphertext'),
  reason: text('reason').notNull(),
  details: text('details'),
  detailsCiphertext: text('details_ciphertext'),
  conversationContextStart: timestamp('conversation_context_start', { withTimezone: true }),
  conversationContextEnd: timestamp('conversation_context_end', { withTimezone: true }),
  status: reportStatusEnum('status').default('OPEN').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  acknowledgeDueAt: timestamp('acknowledge_due_at', { withTimezone: true }).notNull(),
  actionDueAt: timestamp('action_due_at', { withTimezone: true }).notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  publicResponse: text('public_response'),
  publicResponseCiphertext: text('public_response_ciphertext'),
  appealedAt: timestamp('appealed_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  ...timestamps
}, (table) => [
  index('reports_queue_idx').on(table.status, table.actionDueAt),
  uniqueIndex('reports_dedupe_idx').on(table.reporterId, table.targetType, table.targetId, table.reason).where(sql`${table.reporterId} is not null and ${table.targetId} is not null and ${table.status} in ('OPEN','INVESTIGATING')`)
]);

export const reportEvents = pgTable('report_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id').references(() => reports.id, { onDelete: 'cascade' }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  publicMessage: text('public_message'),
  publicMessageCiphertext: text('public_message_ciphertext'),
  internalMessage: text('internal_message'),
  internalMessageCiphertext: text('internal_message_ciphertext'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('report_events_case_idx').on(table.reportId, table.createdAt)]);

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
  recipientUserId: uuid('recipient_user_id').references(() => users.id),
  recipientEmailCiphertext: text('recipient_email_ciphertext'),
  template: text('template').notNull(),
  payload: jsonb('payload').notNull(),
  encryptedPayload: text('encrypted_payload'),
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

export const messageRiskEvents = pgTable('message_risk_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  riskCodes: text('risk_codes').array().notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('message_risk_user_idx').on(table.userId, table.createdAt)]);

export const legalHolds = pgTable('legal_holds', {
  id: uuid('id').defaultRandom().primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  releasedBy: uuid('released_by').references(() => users.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  reviewAt: timestamp('review_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('legal_holds_target_idx').on(table.targetType, table.targetId, table.releasedAt)]);

export const retentionRuns = pgTable('retention_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  counts: jsonb('counts').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
});

export const serviceProviderReviews = pgTable('service_provider_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  providerKey: text('provider_key').notNull().unique(),
  displayName: text('display_name').notNull(),
  purpose: text('purpose').notNull(),
  dataCategories: text('data_categories').array().notNull(),
  region: text('region').notNull(),
  privacyUrl: text('privacy_url').notNull(),
  contractStatus: text('contract_status').default('PENDING').notNull(),
  subprocessorReviewed: boolean('subprocessor_reviewed').default(false).notNull(),
  deletionReviewed: boolean('deletion_reviewed').default(false).notNull(),
  breachTermsReviewed: boolean('breach_terms_reviewed').default(false).notNull(),
  evidenceReference: text('evidence_reference'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  ...timestamps
});

export const staffAccessReviews = pgTable('staff_access_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  subjectUserId: uuid('subject_user_id').references(() => users.id).notNull(),
  roles: text('roles').array().notNull(),
  outcome: text('outcome').notNull(),
  reason: text('reason').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id).notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [index('staff_access_review_subject_idx').on(table.subjectUserId, table.reviewedAt)]);
