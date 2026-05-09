import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { contratos } from "./contratos";

export const contratoDocumentos = pgTable(
  "contrato_documentos",
  {
    id: serial("id").primaryKey(),
    contratoId: integer("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    numero: text("numero"),
    descricao: text("descricao"),
    data: date("data", { mode: "string" }),
    tipo: text("tipo"),
    documentoUrl: text("documento_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contratoIdx: index("contrato_documentos_contrato_idx").on(t.contratoId),
    contratoNumeroUq: uniqueIndex("contrato_documentos_contrato_numero_uq").on(t.contratoId, t.numero),
  }),
);

export type ContratoDocumento = typeof contratoDocumentos.$inferSelect;
export type NewContratoDocumento = typeof contratoDocumentos.$inferInsert;
