CREATE TABLE "email_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"listing_updates" boolean DEFAULT true NOT NULL,
	"transaction_updates" boolean DEFAULT true NOT NULL,
	"message_updates" boolean DEFAULT true NOT NULL,
	"policy_reminders" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "email_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "suppression_reason" text;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("sent_at","failed_at","suppressed_at","available_at");