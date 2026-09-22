CREATE TABLE "analytics_daily_pages" (
	"day" date NOT NULL,
	"route" text NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "analytics_daily_pages_day_route_pk" PRIMARY KEY("day","route"),
	CONSTRAINT "analytics_daily_pages_views_positive" CHECK ("analytics_daily_pages"."views" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_referrers" (
	"day" date NOT NULL,
	"source" text NOT NULL,
	"visits" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "analytics_daily_referrers_day_source_pk" PRIMARY KEY("day","source"),
	CONSTRAINT "analytics_daily_referrers_visits_positive" CHECK ("analytics_daily_referrers"."visits" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_visitors" (
	"day" date NOT NULL,
	"visitor_hash" text NOT NULL,
	"page_views" integer DEFAULT 1 NOT NULL,
	"device_type" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_visitors_day_visitor_hash_pk" PRIMARY KEY("day","visitor_hash"),
	CONSTRAINT "analytics_daily_visitors_page_views_positive" CHECK ("analytics_daily_visitors"."page_views" > 0)
);
--> statement-breakpoint
CREATE INDEX "analytics_daily_pages_day_idx" ON "analytics_daily_pages" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_daily_referrers_day_idx" ON "analytics_daily_referrers" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_daily_visitors_day_idx" ON "analytics_daily_visitors" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_daily_visitors_device_idx" ON "analytics_daily_visitors" USING btree ("day","device_type");