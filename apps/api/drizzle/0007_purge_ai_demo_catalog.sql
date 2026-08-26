DO $purge_ai_demo_catalog$
DECLARE
	demo_users uuid[];
	demo_listings uuid[];
	demo_conversations uuid[];
	demo_transactions uuid[];
	demo_listing_text text[];
	demo_conversation_text text[];
	demo_transaction_text text[];
	demo_user_count integer;
	demo_listing_count integer;
	synthetic_listing_count integer;
BEGIN
	SELECT COALESCE(array_agg("id"), ARRAY[]::uuid[])
	INTO demo_users
	FROM "users"
	WHERE "email" LIKE 'ui-demo-%@example.test';

	demo_user_count := cardinality(demo_users);
	IF demo_user_count = 0 THEN
		RETURN;
	END IF;
	IF demo_user_count <> 8 THEN
		RAISE EXCEPTION 'Refusing demo purge: expected 8 marked users, found %', demo_user_count;
	END IF;

	SELECT COALESCE(array_agg("id"), ARRAY[]::uuid[])
	INTO demo_listings
	FROM "listings"
	WHERE "seller_id" = ANY(demo_users);

	demo_listing_count := cardinality(demo_listings);
	IF demo_listing_count <> 19 THEN
		RAISE EXCEPTION 'Refusing demo purge: expected 19 marked listings, found %', demo_listing_count;
	END IF;

	SELECT count(DISTINCT "listing_id")::integer
	INTO synthetic_listing_count
	FROM "listing_images"
	WHERE "listing_id" = ANY(demo_listings)
		AND "deleted_at" IS NULL
		AND "synthetic_status" = 'SYNTHETIC_OR_MATERIALLY_ALTERED';

	IF synthetic_listing_count <> demo_listing_count OR EXISTS (
		SELECT 1
		FROM "listing_images"
		WHERE "listing_id" = ANY(demo_listings)
			AND "deleted_at" IS NULL
			AND "synthetic_status" <> 'SYNTHETIC_OR_MATERIALLY_ALTERED'
	) THEN
		RAISE EXCEPTION 'Refusing demo purge: marked listings do not match the synthetic-image target set';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "legal_holds"
		WHERE (
			"released_at" IS NULL
			AND (
				("target_type" = 'USER' AND "target_id" = ANY(demo_users))
				OR ("target_type" = 'LISTING' AND "target_id" = ANY(demo_listings))
			)
		) OR "created_by" = ANY(demo_users)
	) THEN
		RAISE EXCEPTION 'Refusing demo purge: an active legal hold covers the target set';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "admin_audit_logs" WHERE "admin_id" = ANY(demo_users)
	) OR EXISTS (
		SELECT 1 FROM "staff_access_reviews"
		WHERE "subject_user_id" = ANY(demo_users) OR "reviewed_by" = ANY(demo_users)
	) THEN
		RAISE EXCEPTION 'Refusing demo purge: a marked user has staff history';
	END IF;

	SELECT COALESCE(array_agg("id"), ARRAY[]::uuid[])
	INTO demo_conversations
	FROM "conversations"
	WHERE "listing_id" = ANY(demo_listings)
		OR "buyer_id" = ANY(demo_users)
		OR "seller_id" = ANY(demo_users);

	SELECT COALESCE(array_agg("id"), ARRAY[]::uuid[])
	INTO demo_transactions
	FROM "transactions"
	WHERE "listing_id" = ANY(demo_listings)
		OR "buyer_id" = ANY(demo_users)
		OR "seller_id" = ANY(demo_users);

	SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
	INTO demo_listing_text
	FROM unnest(demo_listings) AS value;
	SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
	INTO demo_conversation_text
	FROM unnest(demo_conversations) AS value;
	SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
	INTO demo_transaction_text
	FROM unnest(demo_transactions) AS value;

	DELETE FROM "email_outbox"
	WHERE "recipient_user_id" = ANY(demo_users)
		OR COALESCE("payload"->>'listingId', '') = ANY(demo_listing_text)
		OR COALESCE("payload"->>'conversationId', '') = ANY(demo_conversation_text)
		OR COALESCE("payload"->>'transactionId', '') = ANY(demo_transaction_text);

	DELETE FROM "notifications"
	WHERE "user_id" = ANY(demo_users)
		OR EXISTS (SELECT 1 FROM unnest(demo_listing_text) AS value WHERE "href" LIKE '%' || value || '%')
		OR EXISTS (SELECT 1 FROM unnest(demo_conversation_text) AS value WHERE "href" LIKE '%' || value || '%')
		OR EXISTS (SELECT 1 FROM unnest(demo_transaction_text) AS value WHERE "href" LIKE '%' || value || '%');

	DELETE FROM "reviews"
	WHERE "transaction_id" = ANY(demo_transactions)
		OR "reviewer_id" = ANY(demo_users)
		OR "reviewee_id" = ANY(demo_users);

	DELETE FROM "transactions"
	WHERE "id" = ANY(demo_transactions);

	UPDATE "listings"
	SET
		"reserved_buyer_id" = NULL,
		"lifecycle_state" = CASE
			WHEN "lifecycle_state" = 'RESERVED' THEN 'ACTIVE'::lifecycle_state
			ELSE "lifecycle_state"
		END,
		"updated_at" = now()
	WHERE "reserved_buyer_id" = ANY(demo_users)
		AND NOT ("id" = ANY(demo_listings));

	DELETE FROM "message_risk_events"
	WHERE "user_id" = ANY(demo_users)
		OR "message_id" IN (
			SELECT "id" FROM "messages"
			WHERE "conversation_id" = ANY(demo_conversations)
		);
	DELETE FROM "messages"
	WHERE "sender_id" = ANY(demo_users)
		OR "conversation_id" = ANY(demo_conversations);
	DELETE FROM "conversations"
	WHERE "id" = ANY(demo_conversations);

	UPDATE "reports" SET "reporter_id" = NULL
	WHERE "reporter_id" = ANY(demo_users);
	UPDATE "reports" SET "assigned_to" = NULL
	WHERE "assigned_to" = ANY(demo_users);
	UPDATE "report_events" SET "actor_user_id" = NULL
	WHERE "actor_user_id" = ANY(demo_users);

	DELETE FROM "support_messages"
	WHERE "sender_id" = ANY(demo_users);
	DELETE FROM "support_tickets"
	WHERE "user_id" = ANY(demo_users);
	UPDATE "support_tickets" SET "assigned_to" = NULL
	WHERE "assigned_to" = ANY(demo_users);

	UPDATE "academic_domains" SET "reviewed_by" = NULL
	WHERE "reviewed_by" = ANY(demo_users);
	UPDATE "service_provider_reviews" SET "reviewed_by" = NULL
	WHERE "reviewed_by" = ANY(demo_users);
	UPDATE "user_roles" SET "granted_by" = NULL
	WHERE "granted_by" = ANY(demo_users);
	UPDATE "legal_holds" SET "released_by" = NULL
	WHERE "released_by" = ANY(demo_users);

	DELETE FROM "moderation_notes"
	WHERE "moderator_id" = ANY(demo_users);
	DELETE FROM "listing_images"
	WHERE "owner_id" = ANY(demo_users)
		AND NOT ("listing_id" = ANY(demo_listings));
	DELETE FROM "listings"
	WHERE "id" = ANY(demo_listings);
	DELETE FROM "users"
	WHERE "id" = ANY(demo_users);
END
$purge_ai_demo_catalog$;
