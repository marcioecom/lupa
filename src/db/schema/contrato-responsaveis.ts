import { date, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { contratos } from "./contratos";

export const contratoResponsaveis = pgTable(
  "contrato_responsaveis",
  {
    id: serial("id").primaryKey(),
    contratoId: integer("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    nome: text("nome"),
    cpf: text("cpf"),
    funcao: text("funcao"),
    dataInicio: date("data_inicio", { mode: "string" }),
    dataFim: date("data_fim", { mode: "string" }),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contratoIdx: index("contrato_responsaveis_contrato_idx").on(t.contratoId),
    funcaoIdx: index("contrato_responsaveis_funcao_idx").on(t.funcao),
  }),
);

export type ContratoResponsavel = typeof contratoResponsaveis.$inferSelect;
export type NewContratoResponsavel = typeof contratoResponsaveis.$inferInsert;
