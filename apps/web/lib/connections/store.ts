import { and, eq, sql } from "drizzle-orm";
import { GITHUB_INSTALLATION_INDEX } from "../../../../agent/lib/schema";
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
  /** Quick-connect webhook secret. Omitted: an existing row keeps its own (a new row gets none). */
  webhookSecretCiphertext?: string | null;
};

/**
 * Another workspace already holds this GitHub installation. Postgres enforces it atomically with
 * the partial unique index connections_github_installation_unique (drizzle/0004), so two
 * concurrent claims can't both win; the memory store mirrors the rule for tests.
 */
export class InstallationClaimedError extends Error {
  readonly code = "claimed";
  constructor() {
    super("That GitHub installation is already connected to another workspace.");
    this.name = "InstallationClaimedError";
  }
}

/** Is this the unique violation from that index? pg's error may arrive wrapped by Drizzle (`cause`). */
export function isInstallationConflict(error: unknown): boolean {
  let current = error as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (current.code === "23505" && current.constraint === GITHUB_INSTALLATION_INDEX) return true;
    current = current.cause as typeof current;
  }
  return false;
}

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
      const installationId = row.provider === "github" ? (row.config as ConfigFor<"github">).installationId : "";
      const heldElsewhere =
        installationId &&
        [...rows.values()].some(
          (r) =>
            r.provider === "github" &&
            r.workspaceId !== row.workspaceId &&
            (r.config as ConfigFor<"github">).installationId === installationId,
        );
      if (heldElsewhere) throw new InstallationClaimedError();
      const previous = rows.get(key(row.workspaceId, row.provider));
      const webhookSecretCiphertext =
        row.webhookSecretCiphertext === undefined ? (previous?.webhookSecretCiphertext ?? null) : row.webhookSecretCiphertext;
      const saved = { ...row, webhookSecretCiphertext, updatedAt: new Date().toISOString() } as Connection<typeof row.provider>;
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
    webhookSecretCiphertext: row.webhookSecretCiphertext,
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
      const keepWebhookSecret = input.webhookSecretCiphertext === undefined;
      const [row] = await db
        .insert(connections)
        .values({ ...input, config, webhookSecretCiphertext: input.webhookSecretCiphertext ?? null })
        .onConflictDoUpdate({
          target: [connections.workspaceId, connections.provider],
          set: {
            status: input.status,
            config,
            secretCiphertext: input.secretCiphertext,
            connectorRef: input.connectorRef,
            ...(keepWebhookSecret ? {} : { webhookSecretCiphertext: input.webhookSecretCiphertext }),
            updatedAt: sql`now()`,
          },
        })
        .returning()
        .catch((error: unknown) => {
          throw isInstallationConflict(error) ? new InstallationClaimedError() : error;
        });
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
