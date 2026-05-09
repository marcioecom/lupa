import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { config } from "../config";
import * as schema from "./schema";

let pool: Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getPool(overrides?: Partial<PoolConfig>): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.DATABASE_URL, ...overrides });
  }
  return pool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;
export { schema };
