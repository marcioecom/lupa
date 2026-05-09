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
import { contratos } from "./contratos";

export const contratoPagamentos = pgTable(
  "contrato_pagamentos",
  {
    id: serial("id").primaryKey(),
    contratoId: integer("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    data: date("data", { mode: "string" }),
    notaFiscal: text("nota_fiscal"),
    observacao: text("observacao"),
    valorCentavos: bigint("valor_centavos", { mode: "bigint" }),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contratoIdx: index("contrato_pagamentos_contrato_idx").on(t.contratoId),
    dataIdx: index("contrato_pagamentos_data_idx").on(t.data),
  }),
);

export type ContratoPagamento = typeof contratoPagamentos.$inferSelect;
export type NewContratoPagamento = typeof contratoPagamentos.$inferInsert;
