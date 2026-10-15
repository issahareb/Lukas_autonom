CREATE TABLE "lukas_telefon_anfragen" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kontext_id" text,
	"nummer" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'neu' NOT NULL,
	"kategorie" text DEFAULT 'unklar' NOT NULL,
	"zusammenfassung" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '{}' NOT NULL,
	"weitergabe" text DEFAULT 'offen' NOT NULL,
	"auswertung" text DEFAULT 'laeuft' NOT NULL,
	"notiz" text DEFAULT '' NOT NULL,
	"email_status" text DEFAULT 'ausstehend' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"beendet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lukas_telefon_anfragen_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE INDEX "lukas_telefon_anfragen_datum_idx" ON "lukas_telefon_anfragen" USING btree ("created_at");