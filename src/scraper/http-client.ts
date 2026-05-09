import { setTimeout as delay } from "node:timers/promises";
import { request, Agent, type Dispatcher } from "undici";
import { config } from "../config";

export type FetchOptions = {
  method?: "GET" | "POST";
  body?: string | Buffer;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  retryDelaysMs?: number[];
};

export type FetchResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  url: string;
};

const DEFAULT_RETRY_DELAYS_MS = [500, 2_000, 8_000];

const sharedAgent: Dispatcher = new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 30_000,
  connections: config.SCRAPER_CONCURRENCY,
});

function isRetriableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_SOCKET"].includes(code)) {
    return true;
  }
  return /timeout|aborted|socket/i.test(err.message);
}

export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = config.SCRAPER_TIMEOUT_MS,
    retries = DEFAULT_RETRY_DELAYS_MS.length,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  } = options;

  const requestHeaders: Record<string, string> = {
    "User-Agent": config.SCRAPER_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    ...headers,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await request(url, {
        method,
        headers: requestHeaders,
        body,
        bodyTimeout: timeoutMs,
        headersTimeout: timeoutMs,
        dispatcher: sharedAgent,
      });

      const text = await response.body.text();

      if (isRetriableStatus(response.statusCode) && attempt < retries) {
        await delay(retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1]);
        continue;
      }

      if (response.statusCode >= 400) {
        throw new HttpError(response.statusCode, url, text.slice(0, 500));
      }

      return {
        status: response.statusCode,
        headers: response.headers,
        body: text,
        url,
      };
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && !isRetriableStatus(err.status)) {
        throw err;
      }
      if (attempt < retries && isRetriableError(err)) {
        await delay(retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1]);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, bodySnippet: string) {
    super(`HTTP ${status} on ${url}: ${bodySnippet}`);
    this.name = "HttpError";
  }
}

export async function pacedFetch<T>(items: Iterable<T>, fn: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) {
    await fn(item);
    if (config.SCRAPER_REQUEST_DELAY_MS > 0) {
      await delay(config.SCRAPER_REQUEST_DELAY_MS);
    }
  }
}
