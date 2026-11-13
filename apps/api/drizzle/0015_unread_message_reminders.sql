ALTER TABLE "conversations" ADD COLUMN "last_unread_reminder_through_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_unread_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "reminder_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_reminder_conversation_id_conversations_id_fk" FOREIGN KEY ("reminder_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_pending_reminder_idx" ON "email_outbox" USING btree ("reminder_conversation_id") WHERE "email_outbox"."sent_at" is null and "email_outbox"."failed_at" is null and "email_outbox"."suppressed_at" is null;--> statement-breakpoint
CREATE INDEX "messages_unread_conversation_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE "messages"."read_at" is null and "messages"."deleted_at" is null;