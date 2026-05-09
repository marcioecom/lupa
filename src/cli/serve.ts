import { config } from "../config";
import { buildServer } from "../api/server";
import { startScraperScheduler } from "../scraper/scheduler";

async function main() {
  const app = await buildServer();
  const scheduler = config.SCRAPER_SCHEDULE_ENABLED
    ? startScraperScheduler()
    : null;

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down API");
    await scheduler?.stop();
    await app.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
