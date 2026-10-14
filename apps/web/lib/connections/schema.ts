import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Mirror of the `connections` table that santiago/connect-foundation creates and
// migrates. Deliberately NOT in agent/lib/schema.ts (no migration here): when the
// foundation lands, delete this file and import its table instead.
export const connections = pgTable(
  "connections",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    provider: text("provider", { enum: ["github", "sentry", "posthog"] }).notNull(),
    status: text("status", { enum: ["pending", "connected", "error"] }).notNull().default("pending"),
    config: jsonb("config").notNull(),
    secretCiphertext: text("secret_ciphertext"),
    connectorRef: text("connector_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("connections_workspace_provider_idx").on(t.workspaceId, t.provider)],
);
