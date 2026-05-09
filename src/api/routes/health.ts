import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const result = await app.db.execute(sql`select 1 as ok`);
    return { status: "ok", db: result.rows[0]?.ok === 1 ? "ok" : "unknown" };
  });
};
