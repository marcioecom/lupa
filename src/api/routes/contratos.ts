import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { schema } from "../../db/client";

type ListQuery = {
  page?: number;
  pageSize?: number;
  ano?: number;
  modalidade?: string;
  situacao?: string;
  unidadeGestora?: string;
  cnpj?: string;
  licitacaoExternalId?: string;
  vigenciaDe?: string;
  vigenciaAte?: string;
  valorMin?: number;
  valorMax?: number;
  q?: string;
};

export const contratosRoutes: FastifyPluginAsync = async (app) => {
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
          unidadeGestora: { type: "string" },
          cnpj: { type: "string" },
          licitacaoExternalId: { type: "string" },
          vigenciaDe: { type: "string", format: "date" },
          vigenciaAte: { type: "string", format: "date" },
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
    if (query.ano !== undefined) filters.push(eq(schema.contratos.ano, query.ano));
    if (query.modalidade) filters.push(eq(schema.contratos.modalidade, query.modalidade));
    if (query.situacao) filters.push(eq(schema.contratos.situacao, query.situacao));
    if (query.unidadeGestora) filters.push(eq(schema.contratos.unidadeGestora, query.unidadeGestora));
    if (query.cnpj) filters.push(eq(schema.contratos.cnpjEmpresa, query.cnpj));
    if (query.licitacaoExternalId) {
      filters.push(eq(schema.contratos.licitacaoExternalId, query.licitacaoExternalId));
    }
    if (query.valorMin !== undefined) {
      filters.push(gte(schema.contratos.valorCentavos, BigInt(Math.round(query.valorMin * 100))));
    }
    if (query.valorMax !== undefined) {
      filters.push(lte(schema.contratos.valorCentavos, BigInt(Math.round(query.valorMax * 100))));
    }
    if (query.vigenciaDe) filters.push(gte(schema.contratos.vigenciaInicio, query.vigenciaDe));
    if (query.vigenciaAte) filters.push(lte(schema.contratos.vigenciaFim, query.vigenciaAte));
    if (query.q) {
      filters.push(sql`to_tsvector('portuguese', coalesce(${schema.contratos.objeto}, '')) @@ plainto_tsquery('portuguese', ${query.q})`);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.contratos)
      .where(where);

    const rows = await app.db
      .select()
      .from(schema.contratos)
      .where(where)
      .orderBy(desc(schema.contratos.dataPublicacaoExtrato), desc(schema.contratos.id))
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
    const contrato = await findContrato(app, req.params.id);
    if (!contrato) return reply.code(404).send({ error: "not_found" });

    const [documentos, aditivos, apostilamentos, pagamentos, responsaveis] = await Promise.all([
      app.db.select().from(schema.contratoDocumentos)
        .where(eq(schema.contratoDocumentos.contratoId, contrato.id))
        .orderBy(asc(schema.contratoDocumentos.numero)),
      app.db.select().from(schema.contratoAditivos)
        .where(eq(schema.contratoAditivos.contratoId, contrato.id))
        .orderBy(asc(schema.contratoAditivos.data)),
      app.db.select().from(schema.contratoApostilamentos)
        .where(eq(schema.contratoApostilamentos.contratoId, contrato.id))
        .orderBy(asc(schema.contratoApostilamentos.data)),
      app.db.select().from(schema.contratoPagamentos)
        .where(eq(schema.contratoPagamentos.contratoId, contrato.id))
        .orderBy(asc(schema.contratoPagamentos.data)),
      app.db.select().from(schema.contratoResponsaveis)
        .where(eq(schema.contratoResponsaveis.contratoId, contrato.id)),
    ]);

    return { ...contrato, documentos, aditivos, apostilamentos, pagamentos, responsaveis };
  });

  app.get<{ Params: { id: string } }>("/:id/documentos", async (req, reply) =>
    childList(req.params.id, schema.contratoDocumentos, schema.contratoDocumentos.contratoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/aditivos", async (req, reply) =>
    childList(req.params.id, schema.contratoAditivos, schema.contratoAditivos.contratoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/apostilamentos", async (req, reply) =>
    childList(req.params.id, schema.contratoApostilamentos, schema.contratoApostilamentos.contratoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/pagamentos", async (req, reply) =>
    childList(req.params.id, schema.contratoPagamentos, schema.contratoPagamentos.contratoId, app, reply));
  app.get<{ Params: { id: string } }>("/:id/responsaveis", async (req, reply) =>
    childList(req.params.id, schema.contratoResponsaveis, schema.contratoResponsaveis.contratoId, app, reply));

  app.get("/stats/by-modalidade", async () => {
    const rows = await app.db
      .select({
        modalidade: schema.contratos.modalidade,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.contratos.valorCentavos}), 0)::bigint`,
      })
      .from(schema.contratos)
      .groupBy(schema.contratos.modalidade)
      .orderBy(desc(count()));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-situacao", async () => {
    const rows = await app.db
      .select({
        situacao: schema.contratos.situacao,
        count: count(),
        valorTotalCentavos: sql<bigint>`coalesce(sum(${schema.contratos.valorCentavos}), 0)::bigint`,
      })
      .from(schema.contratos)
      .groupBy(schema.contratos.situacao)
      .orderBy(desc(count()));
    return { items: rows.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get("/stats/by-month", async () => {
    const rows = await app.db.execute(sql`
      select
        to_char(date_trunc('month', data_publicacao_extrato), 'YYYY-MM') as month,
        count(*)::int as count,
        coalesce(sum(valor_centavos), 0)::bigint as valor_total_centavos
      from contratos
      where data_publicacao_extrato is not null
      group by 1
      order by 1 desc
    `);
    return { items: rows.rows };
  });

  app.get("/stats/by-empresa", async () => {
    const rows = await app.db.execute(sql`
      select
        empresa_contratada as empresa,
        cnpj_empresa as cnpj,
        count(*)::int as count,
        coalesce(sum(valor_centavos), 0)::bigint as valor_total_centavos
      from contratos
      where empresa_contratada is not null
      group by empresa_contratada, cnpj_empresa
      order by valor_total_centavos desc
      limit 100
    `);
    return { items: rows.rows };
  });
};

async function findContrato(app: any, idParam: string) {
  const [byExternal] = await app.db
    .select()
    .from(schema.contratos)
    .where(eq(schema.contratos.externalId, idParam))
    .limit(1);
  if (byExternal) return byExternal;
  if (/^\d+$/.test(idParam)) {
    const [byPk] = await app.db
      .select()
      .from(schema.contratos)
      .where(eq(schema.contratos.id, Number(idParam)))
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
  const contrato = await findContrato(app, idParam);
  if (!contrato) return reply.code(404).send({ error: "not_found" });
  return { items: await app.db.select().from(table).where(eq(fkColumn, contrato.id)) };
}
