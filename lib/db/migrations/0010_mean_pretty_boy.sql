CREATE TABLE "lukas_website_events" (
	"site" text NOT NULL,
	"id" text NOT NULL,
	"session" text NOT NULL,
	"page" text NOT NULL,
	"path" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "lukas_website_events_site_id_pk" PRIMARY KEY("site","id")
);
--> statement-breakpoint
CREATE INDEX "website_received_idx" ON "lukas_website_events" USING btree ("site","received_at");--> statement-breakpoint
CREATE INDEX "website_session_idx" ON "lukas_website_events" USING btree ("site","session","received_at");