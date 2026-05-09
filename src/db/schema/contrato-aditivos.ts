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

export const contratoAditivos = pgTable(
  "contrato_aditivos",
  {
    id: serial("id").primaryKey(),
    contratoId: integer("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    numero: text("numero"),
    descricao: text("descricao"),
    data: date("data", { mode: "string" }),
    valorCentavos: bigint("valor_centavos", { mode: "bigint" }),
    documentoUrl: text("documento_url"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contratoIdx: index("contrato_aditivos_contrato_idx").on(t.contratoId),
    dataIdx: index("contrato_aditivos_data_idx").on(t.data),
  }),
);

export type ContratoAditivo = typeof contratoAditivos.$inferSelect;
export type NewContratoAditivo = typeof contratoAditivos.$inferInsert;
