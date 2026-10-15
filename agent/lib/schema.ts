import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A team's Roary setup: who belongs to it and which stack it is connected to. Guests (and
// webhook-started runs) use the single `is_demo` workspace, "Roary Demo Shop".
export const workspaces = pgTable(
  "workspaces",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Neon Auth user id of the creator; null for the demo workspace.
    ownerUserId: text("owner_user_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // At most one demo workspace.
  (t) => [uniqueIndex("workspaces_single_demo_idx").on(t.isDemo).where(sql`${t.isDemo}`)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workspace_members_workspace_user_unique").on(t.workspaceId, t.userId)],
);

export const CONNECTION_PROVIDERS = ["github", "sentry", "posthog"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const GITHUB_INSTALLATION_INDEX = "connections_github_installation_unique";

// One row per (workspace, provider). `config` is non-secret routing (github: {installationId,
// repos[]}; sentry: {org, project}; posthog: {projectId, host}). Tokens live encrypted in
// `secretCiphertext` (AES-GCM, agent/lib/crypto.ts) or behind a Vercel Connect connector
// in `connectorRef`, never in `config`.
export const connections = pgTable(
  "connections",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: text("provider", { enum: CONNECTION_PROVIDERS }).notNull(),
    status: text("status").notNull().default("pending"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    secretCiphertext: text("secret_ciphertext"),
    connectorRef: text("connector_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("connections_workspace_provider_unique").on(t.workspaceId, t.provider),
    check("connections_provider_check", sql`${t.provider} in ('github', 'sentry', 'posthog')`),
    // One GitHub App installation belongs to at most one workspace. This makes "first claim wins"
    // atomic: a second workspace's upsert fails with 23505 instead of racing past a read check.
    // Pending rows (installationId "") and the demo row (none) are excluded.
    uniqueIndex(GITHUB_INSTALLATION_INDEX)
      .on(sql`(${t.config}->>'installationId')`)
      .where(sql`${t.provider} = 'github' and coalesce(${t.config}->>'installationId', '') <> ''`),
  ],
);

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
    workspaceId: integer("workspace_id").references(() => workspaces.id),
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
  workspaceId: integer("workspace_id").references(() => workspaces.id),
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
  // Neon Auth user id of whoever signed the offer letter; null for guest hires.
  userId: text("user_id"),
  workspaceId: integer("workspace_id").references(() => workspaces.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Who owns each web chat (eve session). Recorded on first touch / session start; the eve channel
// (agent/channels/eve.ts) refuses every /eve/v1/session/:id route to anyone else.
// owner_key is `<authenticator>:<principalId>`: `neon-auth:<user id>`, `guest:<cookie id>`, ...
export const chatSessions = pgTable("chat_sessions", {
  sessionId: text("session_id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  workspaceId: integer("workspace_id").references(() => workspaces.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Fixed-window usage per scope (`ws:<workspace id>` or `guest:<cookie id>`): messages sent in the
// window, and the model spend AI Gateway reported for it. See agent/lib/usage-limits.ts.
export const usageCounters = pgTable(
  "usage_counters",
  {
    scopeKey: text("scope_key").notNull(),
    period: text("period", { enum: ["hour", "day"] }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    messages: integer("messages").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "usage_counters_pk", columns: [t.scopeKey, t.period, t.windowStart] })],
);
