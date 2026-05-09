import "dotenv/config";
import { z } from "zod";

// TODO: find another way to do this
function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return Boolean(value);
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SCRAPER_BASE_URL: z
    .string()
    .url()
    .default("https://transparencia.tceto.tc.br"),
  SCRAPER_USER_AGENT: z.string().min(1).default("wagner-etl/0.1"),
  SCRAPER_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  SCRAPER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  SCRAPER_SCHEDULE_ENABLED: z.preprocess(parseBool, z.boolean()).default(false),
  SCRAPER_SCHEDULE_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  SCRAPER_SCHEDULE_RUN_ON_START: z
    .preprocess(parseBool, z.boolean())
    .default(true),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_URL: z.string().url().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;
