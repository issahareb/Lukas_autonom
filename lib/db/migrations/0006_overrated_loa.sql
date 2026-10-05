CREATE TABLE "lukas_live_verbrauch" (
	"id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"quelle" text NOT NULL,
	"sekunden" double precision,
	"beendet" boolean DEFAULT false NOT NULL,
	"gestartet_at" timestamp with time zone NOT NULL,
	"aktualisiert_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_openai_guthaben" (
	"id" integer PRIMARY KEY NOT NULL,
	"usd" double precision NOT NULL,
	"organisation" text NOT NULL,
	"bestaetigt_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "lukas_tageskosten_tag_modell_idx";--> statement-breakpoint
ALTER TABLE "lukas_tageskosten" ADD COLUMN "quelle" text DEFAULT 'unzugeordnet' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_meldungen" ADD COLUMN "geprueft_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "lukas_live_verbrauch_start_idx" ON "lukas_live_verbrauch" USING btree ("gestartet_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lukas_tageskosten_tag_modell_quelle_idx" ON "lukas_tageskosten" USING btree ("tag","provider","model","quelle");