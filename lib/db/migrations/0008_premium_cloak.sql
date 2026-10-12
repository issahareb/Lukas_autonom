CREATE TABLE "lukas_telefon_gedaechtnis" (
	"session_id" text PRIMARY KEY NOT NULL,
	"kontakt_id" integer NOT NULL,
	"nummer" text NOT NULL,
	"sichtbarkeit" text NOT NULL,
	"richtung" text NOT NULL,
	"transkript" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"vollstaendig" boolean DEFAULT false NOT NULL,
	"zustimmung_am" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lukas_telefon_gedaechtnis" ADD CONSTRAINT "lukas_telefon_gedaechtnis_kontakt_id_lukas_telefon_nummern_id_fk" FOREIGN KEY ("kontakt_id") REFERENCES "public"."lukas_telefon_nummern"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lukas_telefon_gedaechtnis_kontakt_idx" ON "lukas_telefon_gedaechtnis" USING btree ("kontakt_id","updated_at");