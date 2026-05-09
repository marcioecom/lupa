import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const contratos = pgTable(
  "contratos",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    numero: text("numero").notNull(),
    ano: integer("ano"),
    numeroSequencial: integer("numero_sequencial"),
    modalidade: text("modalidade"),
    finalidade: text("finalidade"),
    unidadeGestora: text("unidade_gestora"),
    empresaContratada: text("empresa_contratada"),
    cnpjEmpresa: text("cnpj_empresa"),
    fundamentoLegal: text("fundamento_legal"),
    objeto: text("objeto"),
    vigenciaInicio: date("vigencia_inicio", { mode: "string" }),
    vigenciaFim: date("vigencia_fim", { mode: "string" }),
    valorCentavos: bigint("valor_centavos", { mode: "bigint" }),
    dataPublicacaoExtrato: date("data_publicacao_extrato", { mode: "string" }),
    situacao: text("situacao"),
    licitacaoExternalId: text("licitacao_external_id"),
    detailUrl: text("detail_url").notNull(),
    contratoPdfUrl: text("contrato_pdf_url"),
    sourceLastUpdate: date("source_last_update", { mode: "string" }),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdUq: uniqueIndex("contratos_external_id_uq").on(t.externalId),
    anoIdx: index("contratos_ano_idx").on(t.ano),
    modalidadeIdx: index("contratos_modalidade_idx").on(t.modalidade),
    situacaoIdx: index("contratos_situacao_idx").on(t.situacao),
    unidadeGestoraIdx: index("contratos_unidade_gestora_idx").on(t.unidadeGestora),
    cnpjIdx: index("contratos_cnpj_idx").on(t.cnpjEmpresa),
    licitacaoExternalIdx: index("contratos_licitacao_external_idx").on(t.licitacaoExternalId),
    vigenciaInicioIdx: index("contratos_vigencia_inicio_idx").on(t.vigenciaInicio),
    vigenciaFimIdx: index("contratos_vigencia_fim_idx").on(t.vigenciaFim),
    valorIdx: index("contratos_valor_idx").on(t.valorCentavos),
    objetoFtsIdx: index("contratos_objeto_fts_idx").using(
      "gin",
      sql`to_tsvector('portuguese', coalesce(${t.objeto}, ''))`,
    ),
  }),
);

export type Contrato = typeof contratos.$inferSelect;
export type NewContrato = typeof contratos.$inferInsert;
