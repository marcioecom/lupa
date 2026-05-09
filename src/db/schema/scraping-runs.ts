import { date, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type ScrapingRunError = {
  url?: string;
  stage?: string;
  attempt?: number;
  message: string;
};

export const scrapingRuns = pgTable(
  "scraping_runs",
  {
    id: serial("id").primaryKey(),
    module: text("module").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    sourceLastUpdateSeen: date("source_last_update_seen", { mode: "string" }),
    pagesScraped: integer("pages_scraped").notNull().default(0),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsInserted: integer("records_inserted").notNull().default(0),
    recordsUpdated: integer("records_updated").notNull().default(0),
    recordsUnchanged: integer("records_unchanged").notNull().default(0),
    detailsFetched: integer("details_fetched").notNull().default(0),
    errors: jsonb("errors").$type<ScrapingRunError[]>().notNull().default([]),
    errorSummary: text("error_summary"),
  },
  (t) => ({
    moduleStartedIdx: index("scraping_runs_module_started_idx").on(t.module, t.startedAt),
    statusIdx: index("scraping_runs_status_idx").on(t.status),
  }),
);

export type ScrapingRun = typeof scrapingRuns.$inferSelect;
export type NewScrapingRun = typeof scrapingRuns.$inferInsert;
