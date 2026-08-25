ALTER TABLE "reports" ADD COLUMN "target_url_ciphertext" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "details_ciphertext" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "purge_after" timestamp with time zone;