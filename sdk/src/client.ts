import { KeelError } from "./errors";

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Agent JWT for proxy calls. Defaults to the API key. */
  agentToken?: string;
  idempotencyKey?: string;
  /** Safe to retry after a 5xx or transport failure. */
  retryable?: boolean;
  /** Return the raw text response instead of parsing JSON. */
  rawText?: boolean;
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "https://api.keel.dev/v1";
const VERSION = "1.0.0";

export class HttpClient {
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpClientOptions) {
    if (!options || typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw new KeelError({
        status: 0,
        code: "missing_api_key",
        message: "Keel requires an API key. Pass { apiKey } with a secret key for this environment.",
      });
    }
    if (options.apiKey.startsWith("pk_")) {
      throw new KeelError({
        status: 0,
        code: "publishable_key_not_allowed",
        message: "The SDK requires a secret key (sk_...). Publishable keys cannot be used from the server.",
      });
    }
    if (options.apiKey.startsWith("sk_") && /_dev_/.test(options.apiKey) && typeof window !== "undefined") {
      throw new KeelError({
        status: 0,
        code: "browser_not_allowed",
        message: "Never bundle a Keel secret key into a browser bundle.",
      });
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 5));
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new KeelError({
        status: 0,
        code: "fetch_unavailable",
        message: "This runtime has no global fetch. Use Node 20+ or pass a fetch implementation.",
      });
    }
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const response = await this.send(options);
    if (options.rawText) return (await response.text()) as unknown as T;

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) throw errorFromResponse(response, data, text);
    if (data === null) {
      throw new KeelError({
        status: response.status,
        code: "invalid_response",
        message: "Keel returned an empty or non-JSON response.",
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
    }
    return data as T;
  }

  private async send(options: RequestOptions): Promise<Response> {
    const url = this.url(options);
    const method = options.method;
    const canRetry5xx = options.retryable === true || method === "GET" || method === "DELETE";

    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchOnce(url, options);
      } catch (error) {
        if (attempt < this.maxRetries && canRetry5xx) {
          await sleep(backoff(attempt));
          attempt += 1;
          continue;
        }
        throw transportError(error, options, this.timeoutMs);
      }

      const retryableStatus = response.status === 429 || (response.status >= 500 && canRetry5xx);
      if (!retryableStatus || attempt >= this.maxRetries) return response;

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await response.text().catch(() => "");
      await sleep(retryAfter ?? backoff(attempt));
      attempt += 1;
    }
  }

  private async fetchOnce(url: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("keel_timeout")), this.timeoutMs);

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `@keel/sdk/${VERSION}`,
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    headers.authorization = `Bearer ${options.agentToken ?? this.apiKey}`;
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    try {
      return await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private url(options: RequestOptions) {
    const url = new URL(`${this.baseUrl}${options.path.startsWith("/") ? "" : "/"}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

function errorFromResponse(response: Response, data: unknown, text: string) {
  const fallbackId = response.headers.get("x-request-id") ?? undefined;
  const body = data as
    | { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
    | null;
  if (body && body.error) {
    return new KeelError({
      status: response.status,
      code: body.error.code ?? "api_error",
      message: body.error.message ?? `Keel returned HTTP ${response.status}.`,
      details: body.error.details,
      requestId: body.error.requestId ?? fallbackId,
    });
  }
  return new KeelError({
    status: response.status,
    code: response.status === 401 ? "unauthorized" : "api_error",
    message:
      text && text.length < 300
        ? text
        : `Keel returned HTTP ${response.status} ${response.statusText}`.trim(),
    requestId: fallbackId,
  });
}

function transportError(error: unknown, options: RequestOptions, timeoutMs: number) {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = /abort|timeout/i.test(message);
  return new KeelError({
    status: 0,
    code: timedOut ? "timeout" : "network_error",
    message: timedOut
      ? `The request to Keel timed out after ${timeoutMs}ms (${options.method} ${options.path}).`
      : `Could not reach Keel (${options.method} ${options.path}): ${message}`,
  });
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10_000);
  return null;
}

function backoff(attempt: number) {
  return Math.min(300 * 2 ** attempt + Math.random() * 150, 5_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
