ALTER TABLE "transactions" ADD COLUMN "exchange_code_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "exchange_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "exchange_code_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "exchange_code_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "exchange_code_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "exchange_code_version_positive" CHECK ("transactions"."exchange_code_version" >= 1);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "exchange_code_attempts_range" CHECK ("transactions"."exchange_code_attempts" between 0 and 5);