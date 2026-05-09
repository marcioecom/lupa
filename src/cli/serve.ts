import { config } from "../config";
import { buildServer } from "../api/server";

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
