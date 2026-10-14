import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Pooled connection (DATABASE_URL) via node-postgres, per Neon's guidance for Vercel Fluid compute.
// attachDatabasePool lets Vercel close idle clients before a function instance is suspended.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export { schema };

// eve tool results must be plain JSON; Drizzle returns Date objects for timestamps.
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
