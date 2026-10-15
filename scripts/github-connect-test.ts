// GitHub connect readiness: the per-environment flag, the atomic installation claim, and the App
// lifecycle webhooks (installation / installation_repositories), as plain functions.
//
//   npx tsx scripts/github-connect-test.ts                              # no network, no DB
//   npx tsx --env-file=.env.devconnect scripts/github-connect-test.ts   # + Postgres checks on a NON-production branch
//
// The Postgres part needs drizzle/0004 applied to that branch. It creates two throwaway
// workspaces and removes them (and their connections) at the end.
import { randomInt } from "node:crypto";

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

const { applyGithubLifecycle, handleLifecycleRequest, lifecycleEventOf, nextRepos } = await import("../agent/lib/github-lifecycle");
type Store = import("../agent/lib/github-lifecycle").LifecycleStore;
type Row = import("../agent/lib/github-lifecycle").GithubRow;
const { githubConnectEnabled } = await import("../apps/web/lib/connections/github-user");
const { createMemoryStore, InstallationClaimedError, isInstallationConflict } = await import("../apps/web/lib/connections/store");

// ---- Flag: read per request from the environment it runs in ---------------------------------
check("flag off when unset", githubConnectEnabled({}) === false);
check("flag on with 1 / true / TRUE", ["1", "true", " TRUE "].every((v) => githubConnectEnabled({ GITHUB_CONNECT_ENABLED: v })));
check("flag off with 0 / false / yes", ["0", "false", "yes"].every((v) => !githubConnectEnabled({ GITHUB_CONNECT_ENABLED: v })));

// ---- Claim: one installation, one workspace (memory mirror of the unique index) -------------
const github = (workspaceId: number, installationId: string) => ({
  workspaceId,
  provider: "github" as const,
  status: "connected" as const,
  config: { installationId, repos: ["acme/web"] },
  secretCiphertext: null,
  connectorRef: "github/roary",
});
const memory = createMemoryStore(new Map());
await memory.upsert(github(1, "111"));
check("memory: a second workspace claiming the same installation throws InstallationClaimedError", await memory.upsert(github(2, "111")).then(() => false, (e) => e instanceof InstallationClaimedError));
check("memory: the owner can re-save its own installation", await memory.upsert(github(1, "111")).then(() => true, () => false));
await memory.upsert({ ...github(3, ""), status: "pending" });
check("memory: two pending rows (installationId \"\") don't collide", await memory.upsert({ ...github(4, ""), status: "pending" }).then(() => true, () => false));
check(
  "conflict detection reads pg's error, also when Drizzle wraps it in `cause`",
  isInstallationConflict({ code: "23505", constraint: "connections_github_installation_unique" }) &&
    isInstallationConflict({ name: "DrizzleQueryError", cause: { code: "23505", constraint: "connections_github_installation_unique" } }) &&
    !isInstallationConflict({ code: "23505", constraint: "connections_workspace_provider_unique" }) &&
    !isInstallationConflict(new Error("boom")),
);

// ---- Lifecycle: pure parts --------------------------------------------------------------------
check("event from header", lifecycleEventOf("installation", {}) === "installation" && lifecycleEventOf("issue_comment", { installation: { id: 1 } }) === null);
check("event from payload shape when the header is missing", lifecycleEventOf(null, { installation: { id: 1 }, repositories_added: [] }) === "installation_repositories");
check("…installation actions too, but not repo events", lifecycleEventOf(null, { action: "deleted", installation: { id: 1 } }) === "installation" && lifecycleEventOf(null, { action: "created", installation: { id: 1 }, repository: {} }) === null);
check("nextRepos drops removed, appends new, keeps order", JSON.stringify(nextRepos(["a/1", "a/2"], ["a/3", "a/1"], ["a/2"])) === JSON.stringify(["a/1", "a/3"]));
check("nextRepos is idempotent (webhook retries)", JSON.stringify(nextRepos(nextRepos(["a/1"], ["a/2"], []), ["a/2"], [])) === JSON.stringify(["a/1", "a/2"]));

function memoryLifecycle(rows: Map<string, Row>): Store {
  return {
    async mutate(id, change) {
      const row = rows.get(id);
      if (!row) return null;
      const next = { ...row, ...(change(row) ?? {}) };
      rows.set(id, next);
      return next;
    },
  };
}
const rows = new Map<string, Row>([["500", { workspaceId: 9, status: "connected", repos: ["acme/web"] }]]);
const store = memoryLifecycle(rows);
const inst = (action: string, extra: object = {}) => ({ action, installation: { id: 500 }, ...extra });
const repo = (full_name: string) => ({ id: 1, name: full_name.split("/")[1], full_name, private: true });

let out = await applyGithubLifecycle("installation_repositories", inst("added", { repositories_added: [repo("acme/api")], repositories_removed: [] }), store);
check("installation_repositories.added appends the repo", out.handled && JSON.stringify(rows.get("500")!.repos) === JSON.stringify(["acme/web", "acme/api"]));
out = await applyGithubLifecycle("installation_repositories", inst("removed", { repositories_added: [], repositories_removed: [repo("acme/web")] }), store);
check("installation_repositories.removed drops the repo", out.handled && JSON.stringify(rows.get("500")!.repos) === JSON.stringify(["acme/api"]));
out = await applyGithubLifecycle("installation", inst("suspend"), store);
check("installation.suspend → status error", out.handled && rows.get("500")!.status === "error");
out = await applyGithubLifecycle("installation", inst("unsuspend"), store);
check("installation.unsuspend → status connected", out.handled && rows.get("500")!.status === "connected");
out = await applyGithubLifecycle("installation", inst("deleted"), store);
check("installation.deleted → status disconnected", out.handled && rows.get("500")!.status === "disconnected");
await applyGithubLifecycle("installation", inst("unsuspend"), store);
check("unsuspend doesn't resurrect an uninstalled row", rows.get("500")!.status === "disconnected");
out = await applyGithubLifecycle("installation", inst("created"), store);
check("installation.created is ignored (the callback proves ownership)", !out.handled && out.reason === "ignored_action");
out = await applyGithubLifecycle("installation", { action: "deleted", installation: { id: 777 } }, store);
check("an installation nobody claimed (the demo shop's) is ignored", !out.handled && out.reason === "unclaimed");
out = await applyGithubLifecycle("installation", { action: "deleted", installation: { id: "1 OR 1=1" } }, store);
check("a non-numeric installation id is ignored", !out.handled && out.reason === "no_installation");

// ---- Lifecycle: the request half of POST /eve/v1/github --------------------------------------
const request = (event: string | null, body: unknown) =>
  new Request("https://roary.test/eve/v1/github", {
    method: "POST",
    headers: { "content-type": "application/json", ...(event ? { "x-github-event": event } : {}) },
    body: JSON.stringify(body),
  });
rows.set("600", { workspaceId: 10, status: "connected", repos: [] });
const deps = (verify: (r: Request, b: string) => unknown) => ({ verify, store: async () => store, log: () => {} });
const passthrough = request("issue_comment", { action: "created", installation: { id: 600 } });
check("other events pass through to eve untouched", (await handleLifecycleRequest(passthrough, deps(() => true))) === null && !passthrough.bodyUsed);
const forged = await handleLifecycleRequest(request("installation", inst("deleted", { installation: { id: 600 } })), deps(() => null));
check("unverified lifecycle webhook → 401, nothing changes", forged?.status === 401 && rows.get("600")!.status === "connected");
const thrown = await handleLifecycleRequest(request("installation", inst("deleted", { installation: { id: 600 } })), deps(() => { throw new Error("bad oidc"); }));
check("a throwing verifier → 401", thrown?.status === 401 && rows.get("600")!.status === "connected");
const ok = await handleLifecycleRequest(request("installation_repositories", { action: "added", installation: { id: 600 }, repositories_added: [repo("acme/new")] }), deps(() => true));
check("verified installation_repositories → 200 and repos updated", ok?.status === 200 && rows.get("600")!.repos.includes("acme/new"));
const noHeader = await handleLifecycleRequest(request(null, { action: "suspend", installation: { id: 600 } }), deps(() => true));
check("missing X-GitHub-Event: routed by payload shape", noHeader?.status === 200 && rows.get("600")!.status === "error");
const failing = await handleLifecycleRequest(request("installation", inst("deleted")), { verify: () => true, store: async () => { throw new Error("db down"); }, log: () => {} });
check("a store failure answers 500 so GitHub can redeliver", failing?.status === 500);

// ---- Postgres: the unique index really makes the claim atomic ---------------------------------
const branch = process.env.NEON_BRANCH;
if (!process.env.DATABASE_URL) {
  console.log("SKIP  Postgres checks (no DATABASE_URL; pass --env-file=.env.devconnect)");
} else if (!branch || branch === "production") {
  console.log(`SKIP  Postgres checks: refusing to write to NEON_BRANCH=${branch ?? "(unset)"}`);
} else {
  process.env.CONNECTIONS_STORE = "";
  const { db, schema } = await import("../agent/lib/db");
  const { inArray, sql } = await import("drizzle-orm");
  const { getConnectionStore } = await import("../apps/web/lib/connections/store");
  const { postgresLifecycleStore } = await import("../agent/lib/github-lifecycle");
  const { findWorkspaceByGithubInstallation } = await import("../agent/lib/workspace");
  const created = await db
    .insert(schema.workspaces)
    .values([{ name: "github-connect-test A" }, { name: "github-connect-test B" }])
    .returning({ id: schema.workspaces.id });
  const [a, b] = created.map((w) => w.id) as [number, number];
  const installationId = String(9_000_000_000 + randomInt(0, 999_999_999));
  try {
    const [index] = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'connections' and indexname = 'connections_github_installation_unique'`,
    ).then((r) => r.rows);
    check(`[${branch}] migration 0004 applied: partial unique index exists`, !!index && index.indexdef.includes("installationId"));

    const pg = await getConnectionStore();
    check("store is postgres", pg.kind === "postgres");
    const race = await Promise.allSettled([pg.upsert(github(a, installationId)), pg.upsert(github(b, installationId))]);
    const won = race.filter((r) => r.status === "fulfilled").length;
    const lost = race.filter((r) => r.status === "rejected" && r.reason instanceof InstallationClaimedError).length;
    check("two workspaces claim the same installation concurrently → exactly one wins", won === 1 && lost === 1);
    const winner = race[0].status === "fulfilled" ? a : b;
    const loser = winner === a ? b : a;
    check("the loser's later attempt is refused too (insert-or-update path)", await pg.upsert(github(loser, installationId)).then(() => false, (e) => e instanceof InstallationClaimedError));
    check("the winner can re-save its own claim", await pg.upsert(github(winner, installationId)).then(() => true, () => false));
    check("webhook routing finds the winner's workspace", (await findWorkspaceByGithubInstallation(installationId))?.id === winner);
    await pg.upsert({ ...github(loser, ""), status: "pending" });
    check("a pending row (installationId \"\") doesn't collide with anything", (await pg.get(loser, "github"))?.status === "pending");

    const lifecycle = await postgresLifecycleStore();
    await applyGithubLifecycle("installation_repositories", { action: "added", installation: { id: Number(installationId) }, repositories_added: [repo("acme/api"), repo("acme/api")] }, lifecycle);
    await applyGithubLifecycle("installation_repositories", { action: "removed", installation: { id: Number(installationId) }, repositories_removed: [repo("acme/web")] }, lifecycle);
    const afterRepos = await pg.get(winner, "github");
    check("Postgres: repos updated by installation_repositories", JSON.stringify(afterRepos?.config.repos) === JSON.stringify(["acme/api"]) && afterRepos?.config.installationId === installationId);
    await Promise.all([1, 2, 3].map(() => applyGithubLifecycle("installation_repositories", { action: "added", installation: { id: Number(installationId) }, repositories_added: [repo("acme/docs")] }, lifecycle)));
    check("Postgres: concurrent retried deliveries add the repo once", JSON.stringify((await pg.get(winner, "github"))?.config.repos) === JSON.stringify(["acme/api", "acme/docs"]));
    await applyGithubLifecycle("installation", { action: "suspend", installation: { id: Number(installationId) } }, lifecycle);
    check("Postgres: suspend → error", (await pg.get(winner, "github"))?.status === "error");
    await applyGithubLifecycle("installation", { action: "deleted", installation: { id: Number(installationId) } }, lifecycle);
    check("Postgres: deleted → disconnected (installationId kept)", (await pg.get(winner, "github"))?.status === "disconnected");
    check("Postgres: the loser's workspace is untouched", (await pg.get(loser, "github"))?.status === "pending");
  } finally {
    await db.delete(schema.connections).where(inArray(schema.connections.workspaceId, [a, b]));
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [a, b]));
    console.log(`cleaned up test workspaces ${a}, ${b}`);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
