UPDATE "users" SET "avatar_id" = 'avatar-01' WHERE "avatar_id" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "avatar_id" SET DEFAULT 'avatar-01';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "avatar_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "avatar_url";
