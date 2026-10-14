// Seeds believable PAST incidents and launches so Roary's desk never looks empty in the demo.
// They are illustrative examples (fake commit SHAs, no PR links), not real history: say so if asked.
//
//   npx tsx --env-file=.env.local scripts/seed-demo.ts            # seed (idempotent, safe to re-run)
//   npx tsx --env-file=.env.local scripts/seed-demo.ts --unseed   # remove ONLY the seeded rows
//
// Markers (so seeded rows are trivially removable and never confused with real ones):
//   incidents: sentry_issue_id starts with "SEED-"
//   launches:  deployment_url starts with SEED_DEPLOY_PREFIX (launches has no natural unique key)
//
// Writes to whatever DATABASE_URL points at. The triage agent reads the incidents table, so
// don't run this while someone is testing triage against it.
import { and, eq, like } from "drizzle-orm";
import { db, schema } from "../agent/lib/db";

const SEED_DEPLOY_PREFIX = "https://seed.roary.demo/";
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

const incidents: (typeof schema.incidents.$inferInsert)[] = [
  {
    sentryIssueId: "SEED-PRICE-NAN",
    title: "Product page shows NaN price for items without a sale price",
    status: "resolved",
    usersAffected: 17,
    diagnosis:
      "formatPrice() divided by salePrice, which is undefined for most catalog items. Started with the 'Show sale badges' deploy. Fixed by falling back to the list price.",
    suspectCommit: "3f9c2ab",
    createdAt: ago(72),
    updatedAt: ago(70),
  },
  {
    sentryIssueId: "SEED-CART-HYDRATION",
    title: "Hydration mismatch on cart badge after reload",
    status: "resolved",
    usersAffected: 6,
    diagnosis:
      "Cart count was read from localStorage during server render. Low impact (badge flickers, no failed orders). Moved the read into useEffect.",
    suspectCommit: "a71e0d4",
    createdAt: ago(48),
    updatedAt: ago(47),
  },
  {
    sentryIssueId: "SEED-WEBHOOK-TIMEOUT",
    title: "Order confirmation email webhook times out under load",
    status: "fix_proposed",
    usersAffected: 3,
    diagnosis:
      "The email provider call is awaited inside the checkout request; p95 hit 9.8s during a traffic spike. Suggested moving it to a background job. Confidence: medium.",
    suspectCommit: "c42d9e1",
    createdAt: ago(20),
    updatedAt: ago(19),
  },
];

const launches: (typeof schema.launches.$inferInsert)[] = [
  {
    repo: "scarranca/roary-demo-shop",
    prNumber: 9001,
    title: "Wishlist: save items for later",
    deploymentUrl: `${SEED_DEPLOY_PREFIX}wishlist`,
    healthSummary: "Healthy. Errors 0 → 0 in 24h, add_to_cart +12% among wishlist users. Thanks for shipping!",
    createdAt: ago(96),
  },
  {
    repo: "scarranca/roary-demo-shop",
    prNumber: 9002,
    title: "Free shipping banner over $50",
    deploymentUrl: `${SEED_DEPLOY_PREFIX}free-shipping`,
    healthSummary: "Healthy. No new errors; checkout_clicked +8% day over day. Nice work.",
    createdAt: ago(30),
  },
];

async function seed() {
  for (const row of incidents) {
    await db
      .insert(schema.incidents)
      .values(row)
      .onConflictDoUpdate({ target: schema.incidents.sentryIssueId, set: { ...row } });
  }
  let added = 0;
  for (const row of launches) {
    const existing = await db
      .select({ id: schema.launches.id })
      .from(schema.launches)
      .where(and(eq(schema.launches.deploymentUrl, row.deploymentUrl!), eq(schema.launches.prNumber, row.prNumber)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.launches).values(row);
      added++;
    }
  }
  console.log(`seeded ${incidents.length} incidents (upserted), ${added} new launches (${launches.length - added} already there)`);
}

async function unseed() {
  const i = await db
    .delete(schema.incidents)
    .where(like(schema.incidents.sentryIssueId, "SEED-%"))
    .returning({ id: schema.incidents.id });
  const l = await db
    .delete(schema.launches)
    .where(like(schema.launches.deploymentUrl, `${SEED_DEPLOY_PREFIX}%`))
    .returning({ id: schema.launches.id });
  console.log(`removed ${i.length} seeded incidents, ${l.length} seeded launches`);
}

await (process.argv.includes("--unseed") ? unseed() : seed());
process.exit(0);
