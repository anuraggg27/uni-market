CREATE TABLE "analytics_daily_page_visitors" (
	"day" date NOT NULL,
	"route" text NOT NULL,
	"identity_hash" text NOT NULL,
	CONSTRAINT "analytics_daily_page_visitors_day_route_identity_hash_pk" PRIMARY KEY("day","route","identity_hash")
);
--> statement-breakpoint
ALTER TABLE "analytics_daily_visitors" ADD COLUMN "identity_hash" text;--> statement-breakpoint
CREATE INDEX "analytics_daily_page_visitors_day_idx" ON "analytics_daily_page_visitors" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_daily_page_visitors_identity_idx" ON "analytics_daily_page_visitors" USING btree ("identity_hash");--> statement-breakpoint
CREATE INDEX "analytics_daily_visitors_identity_idx" ON "analytics_daily_visitors" USING btree ("day","identity_hash");