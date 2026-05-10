import { parseArgs } from "node:util";
import { closeDb } from "../db/client";
import { runObraPipeline } from "../scraper/pipelines/obra-pipeline";

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      "page-from": { type: "string" },
      "page-to": { type: "string" },
    },
  });

  const limit = values.limit ? Number(values.limit) : undefined;
  const pageFrom = values["page-from"] ? Number(values["page-from"]) : undefined;
  const pageTo = values["page-to"] ? Number(values["page-to"]) : undefined;

  const summary = await runObraPipeline({ limit, pageFrom, pageTo });

  console.log(JSON.stringify({ ok: true, summary: serialize(summary) }, null, 2));
}

function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
