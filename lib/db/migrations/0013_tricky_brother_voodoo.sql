CREATE TABLE "lukas_verbrauch_abnahmen" (
	"id" text PRIMARY KEY NOT NULL,
	"root_id" text NOT NULL,
	"ergebnis" text NOT NULL,
	"beleg" text NOT NULL,
	"pruefer" text NOT NULL,
	"erstellt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lukas_verbrauch_aufrufe" ADD COLUMN "nachweis" jsonb;--> statement-breakpoint
ALTER TABLE "lukas_verbrauch_auftraege" ADD COLUMN "messung" jsonb;--> statement-breakpoint
CREATE INDEX "lukas_verbrauch_abnahmen_root_idx" ON "lukas_verbrauch_abnahmen" USING btree ("root_id");