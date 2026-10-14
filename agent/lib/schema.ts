import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Errors Roary has triaged: one row per Sentry issue.
export const incidents = pgTable(
  "incidents",
  {
    id: serial("id").primaryKey(),
    sentryIssueId: text("sentry_issue_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["investigating", "diagnosed", "fix_proposed", "resolved"] })
      .notNull()
      .default("investigating"),
    usersAffected: integer("users_affected"),
    diagnosis: text("diagnosis"),
    suspectCommit: text("suspect_commit"),
    prUrl: text("pr_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("incidents_sentry_issue_id_idx").on(t.sentryIssueId)],
);

// Shipped features Roary reviewed or made a launch video for.
export const launches = pgTable("launches", {
  id: serial("id").primaryKey(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  title: text("title").notNull(),
  deploymentUrl: text("deployment_url"),
  videoUrl: text("video_url"),
  healthSummary: text("health_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Roarys hired in the fitting room (/hire). The JSON columns follow the types in
// apps/web/lib/roary-character.ts (RoaryLook, Personality, Jobs). Images (logo,
// figure snapshot) stay out of the row; avatarUrl is for a Blob upload later.
export const roaryProfiles = pgTable("roary_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species").notNull(),
  look: jsonb("look").notNull(),
  personality: jsonb("personality").notNull(),
  jobs: jsonb("jobs").notNull(),
  autonomy: text("autonomy", { enum: ["suggest", "open_prs"] }).notNull().default("suggest"),
  repo: text("repo"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
