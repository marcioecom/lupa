import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { tagRoutes } from "../plugins/tag-routes";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  tagRoutes(app, "health");

  app.get("/health", async () => {
    const result = await app.db.execute(sql`select 1 as ok`);
    return { status: "ok", db: result.rows[0]?.ok === 1 ? "ok" : "unknown" };
  });
};
