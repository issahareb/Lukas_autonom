ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "mithoeren_zustimmung" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "mithoeren_quelle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "mithoeren_bestaetigt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "mithoeren_zustimmung" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "mithoeren_quelle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_nummern" ADD COLUMN "mithoeren_bestaetigt_am" timestamp with time zone;