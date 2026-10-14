import { and, eq, sql } from "drizzle-orm";
import { connections } from "./schema";
import type { ConfigFor, Connection, ConnectionStatus, Provider } from "./types";

// Typed repository for the `connections` table (contract in ./types.ts). It targets
// Postgres so it lights up as soon as santiago/connect-foundation migrates the table;
// until then (relation missing, or CONNECTIONS_STORE=memory) it keeps rows in memory.

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
  /** Webhook routing and claim checks: which workspace owns this GitHub installation. */
  findByGithubInstallation(installationId: string): Promise<Connection<"github"> | null>;
}

// ---- memory ---------------------------------------------------------------

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

// ---- postgres -------------------------------------------------------------

type Row = typeof connections.$inferSelect;

function fromRow(row: Row): Connection {
  return {
    workspaceId: row.workspaceId,
    provider: row.provider,
    status: row.status,
    config: row.config as Connection["config"],
    secretCiphertext: row.secretCiphertext,
    connectorRef: row.connectorRef,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function createPostgresStore(): Promise<ConnectionStore> {
  // Imported lazily: the shared pool needs DATABASE_URL, which memory mode doesn't.
  const { db } = await import("../../../../agent/lib/db");
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
      const values = { ...input, config: input.config as unknown };
      const [row] = await db
        .insert(connections)
        .values(values)
        .onConflictDoUpdate({
          target: [connections.workspaceId, connections.provider],
          set: {
            status: values.status,
            config: values.config,
            secretCiphertext: values.secretCiphertext,
            connectorRef: values.connectorRef,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return fromRow(row) as Connection<typeof input.provider>;
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

/** Postgres "undefined_table": the foundation migration hasn't run on this database yet. */
function isMissingTable(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "42P01") return true;
  }
  return false;
}

let resolved: Promise<ConnectionStore> | undefined;

export function getConnectionStore(): Promise<ConnectionStore> {
  resolved ??= (async () => {
    if (process.env.CONNECTIONS_STORE === "memory" || !process.env.DATABASE_URL) return createMemoryStore(memoryRows);
    const store = await createPostgresStore();
    try {
      await store.list(-1);
      return store;
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      console.warn("connections table missing (santiago/connect-foundation not migrated); using the in-memory store");
      return createMemoryStore(memoryRows);
    }
  })().catch((error) => {
    resolved = undefined;
    throw error;
  });
  return resolved;
}
