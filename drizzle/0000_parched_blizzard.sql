CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"sentry_issue_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"users_affected" integer,
	"diagnosis" text,
	"suspect_commit" text,
	"pr_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"deployment_url" text,
	"video_url" text,
	"health_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_sentry_issue_id_idx" ON "incidents" USING btree ("sentry_issue_id");