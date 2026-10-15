CREATE TABLE "webhook_deliveries" (
	"workspace_id" integer NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_pk" PRIMARY KEY("workspace_id","provider","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "webhook_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "public_id" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_id_unique" UNIQUE("public_id");