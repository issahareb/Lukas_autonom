CREATE TABLE "lukas_rueckrufe" (
	"id" text PRIMARY KEY NOT NULL,
	"kontakt_id" integer,
	"nummer" text NOT NULL,
	"anlass" text NOT NULL,
	"faellig_am" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'geplant' NOT NULL,
	"conversation_id" integer,
	"ergebnis" text DEFAULT '' NOT NULL,
	"anruf_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lukas_rueckrufe" ADD CONSTRAINT "lukas_rueckrufe_kontakt_id_lukas_telefon_nummern_id_fk" FOREIGN KEY ("kontakt_id") REFERENCES "public"."lukas_telefon_nummern"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lukas_rueckrufe_faellig_idx" ON "lukas_rueckrufe" USING btree ("status","faellig_am");