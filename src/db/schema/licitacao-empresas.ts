import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { licitacoes } from "./licitacoes";

export const licitacaoEmpresas = pgTable(
  "licitacao_empresas",
  {
    id: serial("id").primaryKey(),
    licitacaoId: integer("licitacao_id")
      .notNull()
      .references(() => licitacoes.id, { onDelete: "cascade" }),
    cnpj: text("cnpj"),
    razaoSocial: text("razao_social"),
    situacao: text("situacao"),
    valorPropostaCentavos: bigint("valor_proposta_centavos", { mode: "bigint" }),
    classificacao: text("classificacao"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    licitacaoIdx: index("licitacao_empresas_licitacao_idx").on(t.licitacaoId),
    cnpjIdx: index("licitacao_empresas_cnpj_idx").on(t.cnpj),
  }),
);

export type LicitacaoEmpresa = typeof licitacaoEmpresas.$inferSelect;
export type NewLicitacaoEmpresa = typeof licitacaoEmpresas.$inferInsert;
