CREATE TABLE "lukas_arbeitsfortschritt" (
	"scope" text PRIMARY KEY NOT NULL,
	"auftrag" text NOT NULL,
	"status" text NOT NULL,
	"schritte" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "lukas_arbeitsfortschritt" ADD COLUMN "conversation_id" integer;--> statement-breakpoint
ALTER TABLE "lukas_arbeitsfortschritt" ADD CONSTRAINT "lukas_arbeitsfortschritt_conversation_id_lukas_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."lukas_conversations"("id") ON DELETE cascade ON UPDATE no action;