CREATE TABLE "academic_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"institution_name" text NOT NULL,
	"source_url" text NOT NULL,
	"allow_subdomains" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"review_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"risk_codes" text[] NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"policy" text NOT NULL,
	"version" text NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"source" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"public_message" text,
	"internal_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"counts" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_provider_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"display_name" text NOT NULL,
	"purpose" text NOT NULL,
	"data_categories" text[] NOT NULL,
	"region" text NOT NULL,
	"privacy_url" text NOT NULL,
	"contract_status" text DEFAULT 'PENDING' NOT NULL,
	"subprocessor_reviewed" boolean DEFAULT false NOT NULL,
	"deletion_reviewed" boolean DEFAULT false NOT NULL,
	"breach_terms_reviewed" boolean DEFAULT false NOT NULL,
	"evidence_reference" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_provider_reviews_provider_key_unique" UNIQUE("provider_key")
);
--> statement-breakpoint
CREATE TABLE "staff_access_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"roles" text[] NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"academic_domain_id" uuid NOT NULL,
	"email_ciphertext" text NOT NULL,
	"email_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip_hash" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "reports_queue_idx";--> statement-breakpoint
DROP INDEX "reports_dedupe_idx";--> statement-breakpoint
ALTER TABLE "email_outbox" ALTER COLUMN "recipient_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "reporter_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "target_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "recipient_email_ciphertext" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "encrypted_payload" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "synthetic_status" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "synthetic_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "provenance_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "source_sha256" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "source_provenance_detected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "seller_attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "seller_policy_version" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_risk_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reporter_email_ciphertext" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "public_reference" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "tracking_hash" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "priority" text DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "affected_person" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "target_url" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "acknowledge_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "action_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "public_response" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "appealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "staff_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_email_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_email_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_email_domain" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_email_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "adult_attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "policy_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
UPDATE "reports" SET
	"public_reference" = 'UM-LEGACY-' || upper(substr(replace("id"::text, '-', ''), 1, 12)),
	"tracking_hash" = 'legacy-disabled-' || "id"::text,
	"category" = 'GENERAL',
	"acknowledge_due_at" = "created_at" + interval '24 hours',
	"action_due_at" = "created_at" + interval '7 days';--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "public_reference" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "tracking_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "acknowledge_due_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "action_due_at" SET NOT NULL;--> statement-breakpoint
UPDATE "users" SET "onboarding_complete" = false WHERE "deleted_at" IS NULL;--> statement-breakpoint
UPDATE "listings" SET
	"moderation_state" = 'PENDING',
	"lifecycle_state" = 'DRAFT',
	"approved_at" = NULL,
	"requested_changes" = 'Please reconfirm the seller declarations and declare whether each image is AI-generated or materially altered.'
WHERE "moderation_state" = 'APPROVED' AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "academic_domains" ADD CONSTRAINT "academic_domains_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_risk_events" ADD CONSTRAINT "message_risk_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_risk_events" ADD CONSTRAINT "message_risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_provider_reviews" ADD CONSTRAINT "service_provider_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_reviews" ADD CONSTRAINT "staff_access_reviews_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_reviews" ADD CONSTRAINT "staff_access_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_email_verifications" ADD CONSTRAINT "student_email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_email_verifications" ADD CONSTRAINT "student_email_verifications_academic_domain_id_academic_domains_id_fk" FOREIGN KEY ("academic_domain_id") REFERENCES "public"."academic_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_domains_active_idx" ON "academic_domains" USING btree ("active","domain");--> statement-breakpoint
CREATE INDEX "legal_holds_target_idx" ON "legal_holds" USING btree ("target_type","target_id","released_at");--> statement-breakpoint
CREATE INDEX "message_risk_user_idx" ON "message_risk_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_acceptance_once_idx" ON "policy_acceptances" USING btree ("user_id","policy","version");--> statement-breakpoint
CREATE INDEX "policy_acceptance_user_idx" ON "policy_acceptances" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "report_events_case_idx" ON "report_events" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_access_review_subject_idx" ON "staff_access_reviews" USING btree ("subject_user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "student_email_verifications_user_idx" ON "student_email_verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "student_email_verifications_hash_idx" ON "student_email_verifications" USING btree ("email_hash","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_verified_student_email_idx" ON "users" USING btree ("student_email_hash") WHERE "users"."student_email_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "users_purge_idx" ON "users" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","action_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_dedupe_idx" ON "reports" USING btree ("reporter_id","target_type","target_id","reason") WHERE "reports"."reporter_id" is not null and "reports"."target_id" is not null and "reports"."status" in ('OPEN','INVESTIGATING');--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_public_reference_unique" UNIQUE("public_reference");
