ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_zustimmung" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_quelle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_bestaetigt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_status" text DEFAULT 'aus' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_sid" text;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_account_sid" text;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "aufnahme_dauer" integer;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "aufnahme_zustimmung" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "aufnahme_quelle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "aufnahme_bestaetigt_am" timestamp with time zone;