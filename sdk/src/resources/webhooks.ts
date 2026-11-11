import { createHmac, timingSafeEqual } from "node:crypto";
import type { HttpClient } from "../client";
import type { List, WebhookEndpoint } from "../types";

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  create(input: { url: string; events: string[] }): Promise<WebhookEndpoint> {
    return this.http.request({ method: "POST", path: "/webhooks", body: input });
  }

  list(): Promise<List<WebhookEndpoint>> {
    return this.http.request({ method: "GET", path: "/webhooks" });
  }

  get(id: string): Promise<WebhookEndpoint> {
    return this.http.request({ method: "GET", path: `/webhooks/${encodeURIComponent(id)}` });
  }

  update(
    id: string,
    patch: { url?: string; events?: string[]; status?: "active" | "disabled" },
  ): Promise<WebhookEndpoint> {
    return this.http.request({
      method: "PATCH",
      path: `/webhooks/${encodeURIComponent(id)}`,
      body: patch,
    });
  }

  remove(id: string): Promise<{ id: string; object: "webhook_endpoint"; deleted: true }> {
    return this.http.request({ method: "DELETE", path: `/webhooks/${encodeURIComponent(id)}` });
  }
}

export interface VerifyWebhookOptions {
  secret: string;
  /** The Authab-Signature header value, e.g. `t=1730563200,v1=ab12...`. */
  header: string;
  /** The exact raw request body, before JSON parsing. */
  body: string;
  toleranceSeconds?: number;
  now?: number;
}

/**
 * Verify a Authab webhook delivery. Header format is
 * `t=<unix-seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 */
export function verifyWebhook(options: VerifyWebhookOptions): boolean {
  const { secret, header, body } = options;
  if (!secret || !header) return false;
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now();

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, "utf8");
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
}
