import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  decimal,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const obras = pgTable(
  "obras",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    ano: integer("ano"),
    descricaoIntervencao: text("descricao_intervencao"),
    descricaoBem: text("descricao_bem"),
    empresa: text("empresa"),
    dataInicio: date("data_inicio", { mode: "string" }),
    previsaoTermino: date("previsao_termino", { mode: "string" }),
    valorIntervencaoCentavos: bigint("valor_intervencao_centavos", { mode: "bigint" }),
    valorContratoCentavos: bigint("valor_contrato_centavos", { mode: "bigint" }),
    valorAditivoCentavos: bigint("valor_aditivo_centavos", { mode: "bigint" }),
    situacao: text("situacao"),
    medicoesPercentual: decimal("medicoes_percentual", { precision: 5, scale: 2 }),
    objeto: text("objeto"),
    contratoExternalId: text("contrato_external_id"),
    detailUrl: text("detail_url").notNull(),
    sourceLastUpdate: date("source_last_update", { mode: "string" }),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdUq: uniqueIndex("obras_external_id_uq").on(t.externalId),
    anoIdx: index("obras_ano_idx").on(t.ano),
    situacaoIdx: index("obras_situacao_idx").on(t.situacao),
    empresaIdx: index("obras_empresa_idx").on(t.empresa),
    contratoExternalIdx: index("obras_contrato_external_idx").on(t.contratoExternalId),
    dataInicioIdx: index("obras_data_inicio_idx").on(t.dataInicio),
    previsaoTerminoIdx: index("obras_previsao_termino_idx").on(t.previsaoTermino),
    valorContratoIdx: index("obras_valor_contrato_idx").on(t.valorContratoCentavos),
    descricoesFtsIdx: index("obras_descricoes_fts_idx").using(
      "gin",
      sql`to_tsvector('portuguese', coalesce(${t.descricaoIntervencao}, '') || ' ' || coalesce(${t.descricaoBem}, '') || ' ' || coalesce(${t.objeto}, ''))`,
    ),
  }),
);

export type Obra = typeof obras.$inferSelect;
export type NewObra = typeof obras.$inferInsert;
