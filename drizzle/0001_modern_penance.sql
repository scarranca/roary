CREATE TABLE "roary_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"look" jsonb NOT NULL,
	"personality" jsonb NOT NULL,
	"jobs" jsonb NOT NULL,
	"autonomy" text DEFAULT 'suggest' NOT NULL,
	"repo" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
