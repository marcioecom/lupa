import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { licitacoes } from "./licitacoes";

export const licitacaoContratosAtas = pgTable(
  "licitacao_contratos_atas",
  {
    id: serial("id").primaryKey(),
    licitacaoId: integer("licitacao_id")
      .notNull()
      .references(() => licitacoes.id, { onDelete: "cascade" }),
    numero: text("numero"),
    tipo: text("tipo"),
    dataAssinatura: date("data_assinatura", { mode: "string" }),
    valorCentavos: bigint("valor_centavos", { mode: "bigint" }),
    documentoUrl: text("documento_url"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    licitacaoIdx: index("licitacao_contratos_atas_licitacao_idx").on(t.licitacaoId),
    numeroIdx: index("licitacao_contratos_atas_numero_idx").on(t.numero),
  }),
);

export type LicitacaoContratoAta = typeof licitacaoContratosAtas.$inferSelect;
export type NewLicitacaoContratoAta = typeof licitacaoContratosAtas.$inferInsert;
