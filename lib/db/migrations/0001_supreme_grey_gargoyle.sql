CREATE TABLE "lukas_autonomie_stand" (
	"id" serial PRIMARY KEY NOT NULL,
	"letzter_lauf" timestamp with time zone,
	"stand" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_versand" (
	"id" serial PRIMARY KEY NOT NULL,
	"art" text NOT NULL,
	"fingerabdruck" text NOT NULL,
	"ergebnis" text DEFAULT '' NOT NULL,
	"erledigt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_zugaenge" (
	"id" serial PRIMARY KEY NOT NULL,
	"sitzung" text NOT NULL,
	"feld" text NOT NULL,
	"geheim" text NOT NULL,
	"notiz" text DEFAULT '' NOT NULL,
	"zuletzt_benutzt" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lukas_approvals" ADD COLUMN "geltung" text DEFAULT 'einmal' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_approvals" ADD COLUMN "verbleibend" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lukas_versand_idx" ON "lukas_versand" USING btree ("art","fingerabdruck");--> statement-breakpoint
CREATE UNIQUE INDEX "lukas_zugaenge_sitzung_feld_idx" ON "lukas_zugaenge" USING btree ("sitzung","feld");