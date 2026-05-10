import pino from "pino";
import { config } from "../config";
import { runContratoPipeline } from "./pipelines/contrato-pipeline";
import { runLicitacaoPipeline } from "./pipelines/licitacao-pipeline";
import { runObraPipeline } from "./pipelines/obra-pipeline";

const logger = pino({
  level: config.LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

export type ScraperScheduler = {
  stop: () => Promise<void>;
};

export function startScraperScheduler(): ScraperScheduler {
  const intervalMs = Math.round(config.SCRAPER_SCHEDULE_INTERVAL_HOURS * 60 * 60 * 1000);
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const runCycle = async () => {
    if (stopped) return;
    if (inFlight) {
      logger.warn("skipping scheduled scrape cycle because previous cycle is still running");
      return;
    }

    inFlight = (async () => {
      const startedAt = Date.now();
      logger.info(
        { intervalHours: config.SCRAPER_SCHEDULE_INTERVAL_HOURS },
        "starting scheduled scrape cycle",
      );

      try {
        const licitacoes = await runLicitacaoPipeline();
        const contratos = await runContratoPipeline();
        const obras = await runObraPipeline();
        logger.info(
          {
            durationMs: Date.now() - startedAt,
            licitacoes,
            contratos,
            obras,
          },
          "finished scheduled scrape cycle",
        );
      } catch (err) {
        logger.error({ err }, "scheduled scrape cycle failed");
      } finally {
        inFlight = null;
      }
    })();

    await inFlight;
  };

  if (config.SCRAPER_SCHEDULE_RUN_ON_START) {
    void runCycle();
  }

  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);

  logger.info(
    {
      intervalHours: config.SCRAPER_SCHEDULE_INTERVAL_HOURS,
      runOnStart: config.SCRAPER_SCHEDULE_RUN_ON_START,
    },
    "scraper scheduler started",
  );

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      await inFlight;
      logger.info("scraper scheduler stopped");
    },
  };
}
