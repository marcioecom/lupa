import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const licitacoes = pgTable(
  "licitacoes",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    numero: text("numero").notNull(),
    ano: integer("ano"),
    numeroSequencial: integer("numero_sequencial"),
    modalidade: text("modalidade"),
    descricao: text("descricao"),
    objeto: text("objeto"),
    situacao: text("situacao"),
    dataSessao: date("data_sessao", { mode: "string" }),
    horaSessao: time("hora_sessao"),
    valorEstimadoCentavos: bigint("valor_estimado_centavos", { mode: "bigint" }),
    numeroProcessoInterno: text("numero_processo_interno"),
    localSessao: text("local_sessao"),
    observacao: text("observacao"),
    dataDisponibilizacao: date("data_disponibilizacao", { mode: "string" }),
    detailUrl: text("detail_url").notNull(),
    editalPdfUrl: text("edital_pdf_url"),
    sourceLastUpdate: date("source_last_update", { mode: "string" }),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdUq: uniqueIndex("licitacoes_external_id_uq").on(t.externalId),
    anoIdx: index("licitacoes_ano_idx").on(t.ano),
    modalidadeIdx: index("licitacoes_modalidade_idx").on(t.modalidade),
    situacaoIdx: index("licitacoes_situacao_idx").on(t.situacao),
    dataSessaoIdx: index("licitacoes_data_sessao_idx").on(t.dataSessao),
    valorIdx: index("licitacoes_valor_idx").on(t.valorEstimadoCentavos),
    objetoFtsIdx: index("licitacoes_objeto_fts_idx").using(
      "gin",
      sql`to_tsvector('portuguese', coalesce(${t.objeto}, ''))`,
    ),
  }),
);

export type Licitacao = typeof licitacoes.$inferSelect;
export type NewLicitacao = typeof licitacoes.$inferInsert;
