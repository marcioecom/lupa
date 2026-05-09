import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { licitacoes } from "./licitacoes";

export const licitacaoPregoeiros = pgTable(
  "licitacao_pregoeiros",
  {
    id: serial("id").primaryKey(),
    licitacaoId: integer("licitacao_id")
      .notNull()
      .references(() => licitacoes.id, { onDelete: "cascade" }),
    nome: text("nome"),
    cpf: text("cpf"),
    funcao: text("funcao"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    licitacaoIdx: index("licitacao_pregoeiros_licitacao_idx").on(t.licitacaoId),
  }),
);

export type LicitacaoPregoeiro = typeof licitacaoPregoeiros.$inferSelect;
export type NewLicitacaoPregoeiro = typeof licitacaoPregoeiros.$inferInsert;
