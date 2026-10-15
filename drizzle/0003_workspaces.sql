CREATE TABLE "connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"connector_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_workspace_provider_unique" UNIQUE("workspace_id","provider"),
	CONSTRAINT "connections_provider_check" CHECK ("connections"."provider" in ('github', 'sentry', 'posthog'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "roary_profiles" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_single_demo_idx" ON "workspaces" USING btree ("is_demo") WHERE "workspaces"."is_demo";--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roary_profiles" ADD CONSTRAINT "roary_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Seed the demo workspace that guests, Sentry alerts and GitHub events use. Idempotent.
INSERT INTO "workspaces" ("name", "is_demo")
SELECT 'Roary Demo Shop', true
WHERE NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "is_demo");--> statement-breakpoint
-- Demo connections carry no secret: the demo workspace falls back to the app-level env
-- tokens (SENTRY_AUTH_TOKEN, POSTHOG_API_KEY) and the github/roary Connect connector.
INSERT INTO "connections" ("workspace_id", "provider", "status", "config", "connector_ref")
SELECT w."id", c."provider", 'connected', c."config"::jsonb, c."connector_ref"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('sentry', '{"org":"roary","project":"javascript-nextjs-k4"}', NULL),
  ('posthog', '{"projectId":"665339","host":"https://us.posthog.com"}', NULL),
  ('github', '{"repos":["scarranca/roary-demo-shop"]}', 'github/roary')
) AS c("provider", "config", "connector_ref")
WHERE w."is_demo"
ON CONFLICT ("workspace_id", "provider") DO NOTHING;--> statement-breakpoint
-- Backfill existing records to the demo workspace. Hires signed by a user keep a null
-- workspace (they belong to that person, not the demo); resolveWorkspace attaches them.
UPDATE "incidents" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "is_demo") WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "launches" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "is_demo") WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "roary_profiles" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "is_demo") WHERE "workspace_id" IS NULL AND "user_id" IS NULL;
