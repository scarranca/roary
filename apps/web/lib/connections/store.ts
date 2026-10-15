import { and, eq, sql } from "drizzle-orm";
import type { ConfigFor, Connection, ConnectionStatus, Provider } from "./types";

// Typed repository over the real `connections` table (agent/lib/schema.ts, migration
// drizzle/0003_workspaces.sql), the same rows the agent reads in agent/lib/workspace.ts.
// The in-memory store exists only for unit tests and local dev without a database
// (CONNECTIONS_STORE=memory, or no DATABASE_URL outside production).

export type UpsertConnection<P extends Provider> = {
  workspaceId: number;
  provider: P;
  status: ConnectionStatus;
  config: ConfigFor<P>;
  secretCiphertext: string | null;
  connectorRef: string | null;
};

export interface ConnectionStore {
  readonly kind: "postgres" | "memory";
  list(workspaceId: number): Promise<Connection[]>;
  get<P extends Provider>(workspaceId: number, provider: P): Promise<Connection<P> | null>;
  upsert<P extends Provider>(row: UpsertConnection<P>): Promise<Connection<P>>;
  setStatus(workspaceId: number, provider: Provider, status: ConnectionStatus): Promise<void>;
  /** Claim checks: which workspace owns this GitHub installation. */
  findByGithubInstallation(installationId: string): Promise<Connection<"github"> | null>;
}

// ---- memory (tests / local dev only) ----------------------------------------

type MemoryRows = Map<string, Connection>;
// Survives Next dev hot reloads.
const memoryRows: MemoryRows = ((globalThis as { __roaryConnections?: MemoryRows }).__roaryConnections ??= new Map());
const key = (workspaceId: number, provider: Provider) => `${workspaceId}:${provider}`;

export function createMemoryStore(rows: MemoryRows = new Map()): ConnectionStore {
  return {
    kind: "memory",
    async list(workspaceId) {
      return [...rows.values()].filter((row) => row.workspaceId === workspaceId);
    },
    async get(workspaceId, provider) {
      return (rows.get(key(workspaceId, provider)) as Connection<typeof provider> | undefined) ?? null;
    },
    async upsert(row) {
      const saved = { ...row, updatedAt: new Date().toISOString() } as Connection<typeof row.provider>;
      rows.set(key(row.workspaceId, row.provider), saved);
      return saved;
    },
    async setStatus(workspaceId, provider, status) {
      const row = rows.get(key(workspaceId, provider));
      if (row) rows.set(key(workspaceId, provider), { ...row, status, updatedAt: new Date().toISOString() });
    },
    async findByGithubInstallation(installationId) {
      const row = [...rows.values()].find(
        (r) => r.provider === "github" && (r.config as ConfigFor<"github">).installationId === installationId,
      );
      return (row as Connection<"github"> | undefined) ?? null;
    },
  };
}

// ---- postgres -----------------------------------------------------------------

async function createPostgresStore(): Promise<ConnectionStore> {
  // Imported lazily: the shared pool needs DATABASE_URL, which memory mode doesn't.
  const { db, schema } = await import("../../../../agent/lib/db");
  const { connections } = schema;
  type Row = typeof connections.$inferSelect;

  const fromRow = (row: Row): Connection => ({
    workspaceId: row.workspaceId,
    provider: row.provider,
    status: row.status as ConnectionStatus,
    config: row.config as Connection["config"],
    secretCiphertext: row.secretCiphertext,
    connectorRef: row.connectorRef,
    updatedAt: row.updatedAt.toISOString(),
  });

  return {
    kind: "postgres",
    async list(workspaceId) {
      const rows = await db.select().from(connections).where(eq(connections.workspaceId, workspaceId));
      return rows.map(fromRow);
    },
    async get(workspaceId, provider) {
      const [row] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.workspaceId, workspaceId), eq(connections.provider, provider)))
        .limit(1);
      return row ? (fromRow(row) as Connection<typeof provider>) : null;
    },
    async upsert(input) {
      const config = input.config as unknown as Record<string, unknown>;
      const [row] = await db
        .insert(connections)
        .values({ ...input, config })
        .onConflictDoUpdate({
          target: [connections.workspaceId, connections.provider],
          set: {
            status: input.status,
            config,
            secretCiphertext: input.secretCiphertext,
            connectorRef: input.connectorRef,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return fromRow(row!) as Connection<typeof input.provider>;
    },
    async setStatus(workspaceId, provider, status) {
      await db
        .update(connections)
        .set({ status, updatedAt: sql`now()` })
        .where(and(eq(connections.workspaceId, workspaceId), eq(connections.provider, provider)));
    },
    async findByGithubInstallation(installationId) {
      const [row] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.provider, "github"), sql`${connections.config}->>'installationId' = ${installationId}`))
        .limit(1);
      return row ? (fromRow(row) as Connection<"github">) : null;
    },
  };
}

let resolved: Promise<ConnectionStore> | undefined;

export function memoryStoreSelected(): boolean {
  if (process.env.CONNECTIONS_STORE === "memory") return true;
  return !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
}

export function getConnectionStore(): Promise<ConnectionStore> {
  resolved ??= (memoryStoreSelected() ? Promise.resolve(createMemoryStore(memoryRows)) : createPostgresStore()).catch((error) => {
    resolved = undefined;
    throw error;
  });
  return resolved;
}
