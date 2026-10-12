CREATE TABLE "lukas_verbrauch_aufrufe" (
	"id" text PRIMARY KEY NOT NULL,
	"auftrag_id" text NOT NULL,
	"root_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"quelle" text NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"eingabe" integer,
	"ausgabe" integer,
	"cache_lesen" integer,
	"cache_schreiben" integer,
	"kontext" jsonb NOT NULL,
	"dauer_ms" integer NOT NULL,
	"gestartet_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_verbrauch_auftraege" (
	"id" text PRIMARY KEY NOT NULL,
	"root_id" text NOT NULL,
	"parent_id" text,
	"quelle" text NOT NULL,
	"conversation_id" integer,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"gestartet_at" timestamp with time zone DEFAULT now() NOT NULL,
	"beendet_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "lukas_verbrauch_aufrufe_root_idx" ON "lukas_verbrauch_aufrufe" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "lukas_verbrauch_aufrufe_start_idx" ON "lukas_verbrauch_aufrufe" USING btree ("gestartet_at");--> statement-breakpoint
CREATE INDEX "lukas_verbrauch_auftraege_start_idx" ON "lukas_verbrauch_auftraege" USING btree ("gestartet_at");