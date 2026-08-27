ALTER TABLE "listings" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "listings" AS "listing"
SET "submitted_at" = "submission"."submitted_at"
FROM (
	SELECT "user_id", "href", max("created_at") AS "submitted_at"
	FROM "notifications"
	WHERE "type" = 'LISTING_SUBMITTED'
	GROUP BY "user_id", "href"
) AS "submission"
WHERE "submission"."user_id" = "listing"."seller_id"
	AND "submission"."href" = '/listing/' || "listing"."id"::text;
