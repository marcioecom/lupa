import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { schema } from "../../db/client";
import { tagRoutes } from "../plugins/tag-routes";

type ListQuery = {
  page?: number;
  pageSize?: number;
  ano?: number;
  situacao?: string;
  empresa?: string;
  contratoExternalId?: string;
  valorMin?: number;
  valorMax?: number;
  q?: string;
};

export const obrasRoutes: FastifyPluginAsync = async (app) => {
  tagRoutes(app, "obras");

  app.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          ano: { type: "integer" },
          situacao: { type: "string" },
          empresa: { type: "string" },
          contratoExternalId: { type: "string" },
          valorMin: { type: "number" },
          valorMax: { type: "number" },
          q: { type: "string" },
        },
      },
    },
  }, async (req) => {
    const query = req.query as ListQuery;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    const filters: SQL[] = [];
    if (query.ano !== undefined) filters.push(eq(schema.obras.ano, query.ano));
    if (query.situacao) filters.push(eq(schema.obras.situacao, query.situacao));
    if (query.empresa) filters.push(eq(schema.obras.empresa, query.empresa));
    if (query.contratoExternalId) {
      filters.push(eq(schema.obras.contratoExternalId, query.contratoExternalId));
    }
    if (query.valorMin !== undefined) {
      filters.push(gte(schema.obras.valorContratoCentavos, BigInt(Math.round(query.valorMin * 100))));
    }
    if (query.valorMax !== undefined) {
      filters.push(lte(schema.obras.valorContratoCentavos, BigInt(Math.round(query.valorMax * 100))));
    }
    if (query.q) {
      filters.push(sql`to_tsvector('portuguese', coalesce(${schema.obras.descricaoIntervencao}, '') || ' ' || coalesce(${schema.obras.descricaoBem}, '') || ' ' || coalesce(${schema.obras.objeto}, '')) @@ plainto_tsquery('portuguese', ${query.q})`);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.obras)
      .where(where);

    const rows = await app.db
      .select()
      .from(schema.obras)
      .where(where)
      .orderBy(desc(schema.obras.ano), desc(schema.obras.dataInicio), desc(schema.obras.id))
      .limit(pageSize)
      .offset(offset);

    return {
      page,
      pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / pageSize),
      items: rows,
    };
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const obra = await findObra(app, req.params.id);
    if (!obra) return reply.code(404).send({ error: "not_found" });
    return obra;
  });

  app.get("/stats/by-situacao", async () => {
    const rows = await app.db
      .select({
        situacao: schema.obras.situacao,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.obras.valorContratoCentavos}), 0)::bigint`,
      })
      .from(schema.obras)
      .groupBy(schema.obras.situacao)
      .orderBy(desc(count()));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-ano", async () => {
    const rows = await app.db
      .select({
        ano: schema.obras.ano,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.obras.valorContratoCentavos}), 0)::bigint`,
        valorAditivoTotalCentavos: sql<bigint>`coalesce(sum(${schema.obras.valorAditivoCentavos}), 0)::bigint`,
      })
      .from(schema.obras)
      .groupBy(schema.obras.ano)
      .orderBy(desc(schema.obras.ano));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-empresa", async () => {
    const rows = await app.db.execute(sql`
      select
        empresa,
        count(*)::int as count,
        coalesce(sum(valor_contrato_centavos), 0)::bigint as valor_total_centavos,
        coalesce(avg(medicoes_percentual), 0)::numeric(5,2) as medicoes_medio
      from obras
      where empresa is not null
      group by empresa
      order by valor_total_centavos desc
    `);
    return { items: rows.rows };
  });
};

async function findObra(app: any, idParam: string) {
  const [byExternal] = await app.db
    .select()
    .from(schema.obras)
    .where(eq(schema.obras.externalId, idParam))
    .limit(1);
  if (byExternal) return byExternal;
  if (/^\d+$/.test(idParam)) {
    const [byPk] = await app.db
      .select()
      .from(schema.obras)
      .where(eq(schema.obras.id, Number(idParam)))
      .limit(1);
    return byPk ?? null;
  }
  return null;
}
