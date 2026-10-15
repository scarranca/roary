import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

// Per-workspace (signed in) and per-guest message caps plus a daily model-spend budget, counted
// in fixed UTC windows in `usage_counters`. agent/channels/eve.ts checks them before a message is
// dispatched; the step.completed handler adds the cost AI Gateway reports for each model call.
//
// Every limit is env-configurable; `0` or `off` removes that cap.

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "off") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function limitConfig() {
  return {
    guestPerHour: envNumber("ROARY_GUEST_MSGS_PER_HOUR", 20),
    guestPerDay: envNumber("ROARY_GUEST_MSGS_PER_DAY", 60),
    guestUsdPerDay: envNumber("ROARY_GUEST_USD_PER_DAY", 3),
    userPerHour: envNumber("ROARY_USER_MSGS_PER_HOUR", 100),
    userPerDay: envNumber("ROARY_USER_MSGS_PER_DAY", 500),
    workspaceUsdPerDay: envNumber("ROARY_WORKSPACE_USD_PER_DAY", 20),
    // All guests share the demo workspace; this caps what anonymous traffic can spend in total.
    demoUsdPerDay: envNumber("ROARY_DEMO_USD_PER_DAY", 50),
  };
}

export type Period = "hour" | "day";

export type LimitPolicy = {
  /** Who the message counts against: `guest:<id>` or `ws:<workspace id>`. */
  readonly messageScope: string;
  readonly perHour: number;
  readonly perDay: number;
  /** Daily USD budgets that must all have room left. */
  readonly budgets: readonly { readonly scope: string; readonly usdPerDay: number }[];
  /** Words for the friendly message, e.g. "guest" or "workspace". */
  readonly audience: "guest" | "workspace";
};

export function guestPolicy(guestId: string, demoWorkspaceId: number): LimitPolicy {
  const c = limitConfig();
  return {
    messageScope: `guest:${guestId}`,
    perHour: c.guestPerHour,
    perDay: c.guestPerDay,
    budgets: [
      { scope: `guest:${guestId}`, usdPerDay: c.guestUsdPerDay },
      { scope: `ws:${demoWorkspaceId}`, usdPerDay: c.demoUsdPerDay },
    ],
    audience: "guest",
  };
}

export function workspacePolicy(workspaceId: number): LimitPolicy {
  const c = limitConfig();
  return {
    messageScope: `ws:${workspaceId}`,
    perHour: c.userPerHour,
    perDay: c.userPerDay,
    budgets: [{ scope: `ws:${workspaceId}`, usdPerDay: c.workspaceUsdPerDay }],
    audience: "workspace",
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function windowStart(period: Period, now = Date.now()): Date {
  const size = period === "hour" ? HOUR : DAY;
  return new Date(Math.floor(now / size) * size); // UTC: epoch ms are UTC-aligned
}

function windowEnd(period: Period, now = Date.now()): Date {
  return new Date(windowStart(period, now).getTime() + (period === "hour" ? HOUR : DAY));
}

export type LimitDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "hourly" | "daily" | "budget"; readonly resetsAt: Date; readonly message: string };

export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function blocked(policy: LimitPolicy, reason: "hourly" | "daily" | "budget", resetsAt: Date, now: number): LimitDecision {
  const what =
    reason === "budget"
      ? "today's usage budget"
      : `the ${policy.audience} limit of ${reason === "hourly" ? policy.perHour : policy.perDay} messages ${reason === "hourly" ? "an hour" : "a day"}`;
  const hint = policy.audience === "guest" ? " Sign in for a higher limit." : "";
  return {
    ok: false,
    reason,
    resetsAt,
    message: `Roary's taking a breather — ${what} is reached. Resets in ${formatWait(resetsAt.getTime() - now)}.${hint}`,
  };
}

/** Adds one to the window's message count unless it is already at `limit`; false when full. */
async function increment(scope: string, period: Period, limit: number, now: number): Promise<boolean> {
  if (limit <= 0) return true;
  const start = windowStart(period, now);
  const rows = await db.execute<{ messages: number }>(sql`
    insert into usage_counters (scope_key, period, window_start, messages)
    values (${scope}, ${period}, ${start.toISOString()}, 1)
    on conflict (scope_key, period, window_start) do update
      set messages = usage_counters.messages + 1, updated_at = now()
      where usage_counters.messages < ${limit}
    returning messages`);
  return rows.rows.length > 0 && Number(rows.rows[0]!.messages) <= limit;
}

async function decrement(scope: string, period: Period, now: number): Promise<void> {
  await db
    .update(schema.usageCounters)
    .set({ messages: sql`greatest(${schema.usageCounters.messages} - 1, 0)` })
    .where(
      and(
        eq(schema.usageCounters.scopeKey, scope),
        eq(schema.usageCounters.period, period),
        eq(schema.usageCounters.windowStart, windowStart(period, now)),
      ),
    );
}

/** Today's reported spend for each scope, in USD. */
export async function spendToday(scopes: readonly string[], now = Date.now()): Promise<Map<string, number>> {
  const spend = new Map<string, number>();
  if (scopes.length === 0) return spend;
  const rows = await db
    .select({ scope: schema.usageCounters.scopeKey, costUsd: schema.usageCounters.costUsd })
    .from(schema.usageCounters)
    .where(
      and(
        inArray(schema.usageCounters.scopeKey, [...scopes]),
        eq(schema.usageCounters.period, "day"),
        eq(schema.usageCounters.windowStart, windowStart("day", now)),
      ),
    );
  for (const row of rows) spend.set(row.scope, row.costUsd);
  return spend;
}

/**
 * Counts one message against `policy`, or explains which limit is full and when it resets.
 * A refused message is not counted.
 */
export async function checkAndCountMessage(policy: LimitPolicy, now = Date.now()): Promise<LimitDecision> {
  const budgets = policy.budgets.filter((b) => b.usdPerDay > 0);
  const spend = await spendToday(budgets.map((b) => b.scope), now);
  if (budgets.some((b) => (spend.get(b.scope) ?? 0) >= b.usdPerDay)) {
    return blocked(policy, "budget", windowEnd("day", now), now);
  }
  if (!(await increment(policy.messageScope, "hour", policy.perHour, now))) {
    return blocked(policy, "hourly", windowEnd("hour", now), now);
  }
  if (!(await increment(policy.messageScope, "day", policy.perDay, now))) {
    if (policy.perHour > 0) await decrement(policy.messageScope, "hour", now);
    return blocked(policy, "daily", windowEnd("day", now), now);
  }
  return { ok: true };
}

export type StepUsage = {
  readonly costUsd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

/** Adds one model call's reported usage to today's row for each scope. */
export async function recordUsage(scopes: readonly string[], usage: StepUsage, now = Date.now()): Promise<void> {
  const cost = usage.costUsd ?? 0;
  const input = Math.round(usage.inputTokens ?? 0);
  const output = Math.round(usage.outputTokens ?? 0);
  if (!cost && !input && !output) return;
  const start = windowStart("day", now).toISOString();
  for (const scope of new Set(scopes)) {
    await db.execute(sql`
      insert into usage_counters (scope_key, period, window_start, cost_usd, input_tokens, output_tokens)
      values (${scope}, 'day', ${start}, ${cost}, ${input}, ${output})
      on conflict (scope_key, period, window_start) do update
        set cost_usd = usage_counters.cost_usd + excluded.cost_usd,
            input_tokens = usage_counters.input_tokens + excluded.input_tokens,
            output_tokens = usage_counters.output_tokens + excluded.output_tokens,
            updated_at = now()`);
  }
}
