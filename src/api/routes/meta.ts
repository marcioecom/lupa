import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { schema } from "../../db/client";

export const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/last-scrape", async (req) => {
    const moduleParam = (req.query as { module?: string }).module ?? "licitacao";
    const [row] = await app.db
      .select()
      .from(schema.scrapingRuns)
      .where(eq(schema.scrapingRuns.module, moduleParam))
      .orderBy(desc(schema.scrapingRuns.startedAt))
      .limit(1);
    if (!row) return { module: moduleParam, run: null };
    return { module: moduleParam, run: row };
  });
};
