ALTER TYPE "public"."notification_type" ADD VALUE 'AVATAR_UNLOCKED';--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_pk" PRIMARY KEY("user_id","achievement"),
	CONSTRAINT "user_achievement_known" CHECK ("user_achievements"."achievement" in ('FIRST_LISTING', 'FIRST_PURCHASE'))
);
--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "user_achievements" ("user_id", "achievement", "unlocked_at")
SELECT "seller_id", 'FIRST_LISTING', min("submitted_at")
FROM "listings"
WHERE "submitted_at" IS NOT NULL
GROUP BY "seller_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "user_achievements" ("user_id", "achievement", "unlocked_at")
SELECT "buyer_id", 'FIRST_PURCHASE', min("completed_at")
FROM "transactions"
WHERE "status" = 'COMPLETED' AND "completed_at" IS NOT NULL
GROUP BY "buyer_id"
ON CONFLICT DO NOTHING;
