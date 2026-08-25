ALTER TABLE "report_events" ADD COLUMN "public_message_ciphertext" text;--> statement-breakpoint
ALTER TABLE "report_events" ADD COLUMN "internal_message_ciphertext" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "public_response_ciphertext" text;