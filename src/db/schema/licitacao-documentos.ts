import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { licitacoes } from "./licitacoes";

export const licitacaoDocumentos = pgTable(
  "licitacao_documentos",
  {
    id: serial("id").primaryKey(),
    licitacaoId: integer("licitacao_id")
      .notNull()
      .references(() => licitacoes.id, { onDelete: "cascade" }),
    numero: text("numero"),
    descricao: text("descricao"),
    data: date("data", { mode: "string" }),
    tipo: text("tipo"),
    documentoUrl: text("documento_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    licitacaoIdx: index("licitacao_documentos_licitacao_idx").on(t.licitacaoId),
    licitacaoNumeroUq: uniqueIndex("licitacao_documentos_licitacao_numero_uq").on(
      t.licitacaoId,
      t.numero,
    ),
  }),
);

export type LicitacaoDocumento = typeof licitacaoDocumentos.$inferSelect;
export type NewLicitacaoDocumento = typeof licitacaoDocumentos.$inferInsert;
