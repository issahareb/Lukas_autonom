ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "kontext_id" text;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "provider_sid" text;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "sip_sid" text;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "ziel_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "sip_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "live_bereit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "conversation_id" integer;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "dauer" integer;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD CONSTRAINT "lukas_telefon_anrufe_kontext_id_unique" UNIQUE("kontext_id");--> statement-breakpoint
ALTER TABLE "lukas_telefon_anrufe" ADD CONSTRAINT "lukas_telefon_anrufe_provider_sid_unique" UNIQUE("provider_sid");