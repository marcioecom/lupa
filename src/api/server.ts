import Fastify, { type FastifyInstance } from "fastify";
import { config } from "../config";
import { closeDb, getDb } from "../db/client";
import { registerDocs } from "./plugins/docs";
import { contratosRoutes } from "./routes/contratos";
import { healthRoutes } from "./routes/health";
import { licitacoesRoutes } from "./routes/licitacoes";
import { metaRoutes } from "./routes/meta";
import { obrasRoutes } from "./routes/obras";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: { target: "pino-pretty", options: { colorize: true } },
    },
    ajv: { customOptions: { coerceTypes: true } },
  });

  app.addHook("preSerialization", async (_req, _reply, payload) =>
    convertBigints(payload),
  );

  app.decorate("db", getDb());

  app.addHook("onClose", async () => {
    await closeDb();
  });

  await registerDocs(app);

  await app.register(healthRoutes);
  await app.register(metaRoutes, { prefix: "/api/meta" });
  await app.register(licitacoesRoutes, { prefix: "/api/licitacoes" });
  await app.register(contratosRoutes, { prefix: "/api/contratos" });
  await app.register(obrasRoutes, { prefix: "/api/obras" });

  return app;
}

function convertBigints(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(convertBigints);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = convertBigints(v);
    return out;
  }
  return value;
}

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof getDb>;
  }
}
