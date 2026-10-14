// End-to-end check of the Neon wiring: runs Roary's DB tools against DATABASE_URL.
// Usage: npx tsx --env-file=.env.local scripts/db-smoke.ts
import { eq } from "drizzle-orm";
import { db, schema } from "../agent/lib/db";
import listIncidents from "../agent/tools/list_incidents";
import saveIncident from "../agent/tools/save_incident";

const id = `SMOKE-${Date.now()}`;
const ctx = {} as never;
const run = (tool: unknown, input: unknown) => (tool as { execute: (i: unknown, c: never) => Promise<unknown> }).execute(input, ctx);

const created = await run(saveIncident, { sentryIssueId: id, title: "Smoke test", status: "investigating" });
const updated = await run(saveIncident, { sentryIssueId: id, title: "Smoke test", status: "diagnosed", usersAffected: 42 });
const listed = (await run(listIncidents, { status: "diagnosed", limit: 5 })) as { sentryIssueId: string }[];
console.log({ created, updated, foundInList: listed.some((r) => r.sentryIssueId === id) });

await db.delete(schema.incidents).where(eq(schema.incidents.sentryIssueId, id));
console.log("cleaned up", id);
process.exit(0);
