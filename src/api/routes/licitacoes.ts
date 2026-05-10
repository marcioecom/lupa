import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { schema } from "../../db/client";
import { tagRoutes } from "../plugins/tag-routes";

type ListQuery = {
  page?: number;
  pageSize?: number;
  ano?: number;
  modalidade?: string;
  situacao?: string;
  valorMin?: number;
  valorMax?: number;
  dataDe?: string;
  dataAte?: string;
  q?: string;
};

export const licitacoesRoutes: FastifyPluginAsync = async (app) => {
  tagRoutes(app, "licitacoes");

  app.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          ano: { type: "integer" },
          modalidade: { type: "string" },
          situacao: { type: "string" },
          valorMin: { type: "number" },
          valorMax: { type: "number" },
          dataDe: { type: "string", format: "date" },
          dataAte: { type: "string", format: "date" },
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
    if (query.ano !== undefined) filters.push(eq(schema.licitacoes.ano, query.ano));
    if (query.modalidade) filters.push(eq(schema.licitacoes.modalidade, query.modalidade));
    if (query.situacao) filters.push(eq(schema.licitacoes.situacao, query.situacao));
    if (query.valorMin !== undefined) {
      filters.push(gte(schema.licitacoes.valorEstimadoCentavos, BigInt(Math.round(query.valorMin * 100))));
    }
    if (query.valorMax !== undefined) {
      filters.push(lte(schema.licitacoes.valorEstimadoCentavos, BigInt(Math.round(query.valorMax * 100))));
    }
    if (query.dataDe) filters.push(gte(schema.licitacoes.dataSessao, query.dataDe));
    if (query.dataAte) filters.push(lte(schema.licitacoes.dataSessao, query.dataAte));
    if (query.q) {
      filters.push(sql`to_tsvector('portuguese', coalesce(${schema.licitacoes.objeto}, '')) @@ plainto_tsquery('portuguese', ${query.q})`);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.licitacoes)
      .where(where);

    const rows = await app.db
      .select()
      .from(schema.licitacoes)
      .where(where)
      .orderBy(desc(schema.licitacoes.dataSessao), desc(schema.licitacoes.id))
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
    const licitacao = await findLicitacao(app, req.params.id);
    if (!licitacao) return reply.code(404).send({ error: "not_found" });

    const [documentos, empresas, pregoeiros, contratosAtas] = await Promise.all([
      app.db.select().from(schema.licitacaoDocumentos)
        .where(eq(schema.licitacaoDocumentos.licitacaoId, licitacao.id))
        .orderBy(asc(schema.licitacaoDocumentos.numero)),
      app.db.select().from(schema.licitacaoEmpresas)
        .where(eq(schema.licitacaoEmpresas.licitacaoId, licitacao.id)),
      app.db.select().from(schema.licitacaoPregoeiros)
        .where(eq(schema.licitacaoPregoeiros.licitacaoId, licitacao.id)),
      app.db.select().from(schema.licitacaoContratosAtas)
        .where(eq(schema.licitacaoContratosAtas.licitacaoId, licitacao.id)),
    ]);

    return { ...licitacao, documentos, empresas, pregoeiros, contratosAtas };
  });

  app.get<{ Params: { id: string } }>("/:id/documentos", async (req, reply) =>
    childList(req.params.id, schema.licitacaoDocumentos, schema.licitacaoDocumentos.licitacaoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/empresas", async (req, reply) =>
    childList(req.params.id, schema.licitacaoEmpresas, schema.licitacaoEmpresas.licitacaoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/pregoeiros", async (req, reply) =>
    childList(req.params.id, schema.licitacaoPregoeiros, schema.licitacaoPregoeiros.licitacaoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/contratos-atas", async (req, reply) =>
    childList(req.params.id, schema.licitacaoContratosAtas, schema.licitacaoContratosAtas.licitacaoId, app, reply));

  app.get("/stats/by-modalidade", async () => {
    const rows = await app.db
      .select({
        modalidade: schema.licitacoes.modalidade,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.licitacoes.valorEstimadoCentavos}), 0)::bigint`,
      })
      .from(schema.licitacoes)
      .groupBy(schema.licitacoes.modalidade)
      .orderBy(desc(count()));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-situacao", async () => {
    const rows = await app.db
      .select({
        situacao: schema.licitacoes.situacao,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.licitacoes.valorEstimadoCentavos}), 0)::bigint`,
      })
      .from(schema.licitacoes)
      .groupBy(schema.licitacoes.situacao)
      .orderBy(desc(count()));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-month", async () => {
    const rows = await app.db.execute(sql`
      select
        to_char(date_trunc('month', data_sessao), 'YYYY-MM') as month,
        count(*)::int as count,
        coalesce(sum(valor_estimado_centavos), 0)::bigint as valor_total_centavos
      from licitacoes
      where data_sessao is not null
      group by 1
      order by 1 desc
    `);
    return { items: rows.rows };
  });
};

async function findLicitacao(app: any, idParam: string) {
  const [byExternal] = await app.db
    .select()
    .from(schema.licitacoes)
    .where(eq(schema.licitacoes.externalId, idParam))
    .limit(1);
  if (byExternal) return byExternal;
  if (/^\d+$/.test(idParam)) {
    const [byPk] = await app.db
      .select()
      .from(schema.licitacoes)
      .where(eq(schema.licitacoes.id, Number(idParam)))
      .limit(1);
    return byPk ?? null;
  }
  return null;
}

async function childList(
  idParam: string,
  table: any,
  fkColumn: any,
  app: any,
  reply: any,
) {
  const licitacao = await findLicitacao(app, idParam);
  if (!licitacao) return reply.code(404).send({ error: "not_found" });
  return { items: await app.db.select().from(table).where(eq(fkColumn, licitacao.id)) };
}
