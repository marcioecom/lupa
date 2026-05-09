import { date, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { contratos } from "./contratos";

export const contratoApostilamentos = pgTable(
  "contrato_apostilamentos",
  {
    id: serial("id").primaryKey(),
    contratoId: integer("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    numero: text("numero"),
    descricao: text("descricao"),
    data: date("data", { mode: "string" }),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contratoIdx: index("contrato_apostilamentos_contrato_idx").on(t.contratoId),
  }),
);

export type ContratoApostilamento = typeof contratoApostilamentos.$inferSelect;
export type NewContratoApostilamento = typeof contratoApostilamentos.$inferInsert;
