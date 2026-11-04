CREATE TABLE "lukas_arbeitsfortschritt" (
	"scope" text PRIMARY KEY NOT NULL,
	"auftrag" text NOT NULL,
	"status" text NOT NULL,
	"schritte" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
