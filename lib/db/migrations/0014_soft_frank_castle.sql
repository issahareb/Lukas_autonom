CREATE TABLE "lukas_verbrauch_berichte" (
	"id" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"daten" jsonb NOT NULL,
	"erstellt_at" timestamp with time zone DEFAULT now() NOT NULL
);
