import { createHmac } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { db } from "./db";
import { decryptSecret, encryptSecret, randomToken } from "./crypto";
import { isPrivateAddress, privateHostname } from "./outbound";

export type WebhookEvent =
  | "approval.requested"
  | "approval.decided"
  | "approval.escalated"
  | "agent.status_changed"
  | "credential.expiring"
  | "anomaly.detected"
  | "agent.registered"
  | "proxy.call";

export const WEBHOOK_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: "approval.requested", label: "Approval requested" },
  { value: "approval.decided", label: "Approval decided" },
  { value: "approval.escalated", label: "Approval escalated" },
  { value: "agent.status_changed", label: "Agent status changed" },
  { value: "credential.expiring", label: "Credential expiring" },
  { value: "anomaly.detected", label: "Anomaly detected" },
  { value: "agent.registered", label: "Agent registered" },
];

const MAX_ATTEMPTS = 5;

function privateAllowed() {
  return process.env.AUTHAB_ALLOW_PRIVATE_WEBHOOKS === "1" && process.env.NODE_ENV !== "production";
}

export async function assertSafeWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Provide a valid webhook URL.");
  }
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain credentials.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production")) {
    throw new Error("Webhook endpoints must use HTTPS.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!privateAllowed()) {
    if (privateHostname(host) || (!isIP(host) && !host.includes("."))) {
      throw new Error("Webhook endpoints must be publicly reachable.");
    }
    if (isIP(host) && isPrivateAddress(host)) {
      throw new Error("Webhook endpoints cannot target private or loopback addresses.");
    }
    let addresses: { address: string }[];
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("Could not resolve the webhook host.");
    }
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("Webhook endpoints cannot resolve to private or loopback addresses.");
    }
  }

  return url.toString();
}

export function generateWebhookSecret() {
  return `whsec_${randomToken(24)}`;
}

export async function storeWebhookSecret(projectId: string, secret: string) {
  const { encryptedPayload, dataKeyEncrypted } = await encryptSecret(projectId, { secret });
  return JSON.stringify({ encryptedPayload, dataKeyEncrypted });
}

export async function readWebhookSecret(projectId: string, stored: string) {
  const parsed = JSON.parse(stored) as { encryptedPayload: string; dataKeyEncrypted: string };
  const value = await decryptSecret(projectId, parsed.encryptedPayload, parsed.dataKeyEncrypted);
  return value.secret as string;
}

export function signWebhook(secret: string, timestamp: number, body: string) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function nextRetryAt(attempt: number) {
  if (attempt >= MAX_ATTEMPTS) return null;
  return new Date(Date.now() + Math.min(60_000 * 2 ** (attempt - 1), 60 * 60_000));
}

async function attemptDelivery(input: {
  deliveryId: string;
  webhookId: string;
  url: string;
  projectId: string;
  storedSecret: string;
  event: string;
  eventId: string;
  body: string;
  attempt: number;
}) {
  try {
    const safeUrl = await assertSafeWebhookUrl(input.url);
    const secret = await readWebhookSecret(input.projectId, input.storedSecret);
    const timestamp = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(safeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authab-Event": input.event,
          "Authab-Event-Id": input.eventId,
          "Authab-Signature": signWebhook(secret, timestamp, input.body),
        },
        body: input.body,
        redirect: "error",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    await db.webhookDelivery.update({
      where: { id: input.deliveryId },
      data: {
        attempt: input.attempt,
        statusCode: response.status,
        deliveredAt: response.ok ? new Date() : null,
        error: response.ok ? null : `HTTP ${response.status}`,
        nextRetryAt: response.ok
          ? null
          : response.status >= 500 || response.status === 429
            ? nextRetryAt(input.attempt)
            : null,
      },
    });
    await db.webhookEndpoint.update({
      where: { id: input.webhookId },
      data: { lastDeliveryAt: new Date() },
    });
    return response.ok;
  } catch (error) {
    await db.webhookDelivery.update({
      where: { id: input.deliveryId },
      data: {
        attempt: input.attempt,
        error: error instanceof Error ? error.message : "Delivery failed",
        nextRetryAt: nextRetryAt(input.attempt),
      },
    });
    return false;
  }
}

export async function deliverWebhook(opts: {
  webhookId: string;
  url: string;
  projectId: string;
  storedSecret: string;
  event: string;
  payload: Record<string, unknown>;
}) {
  const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify({ id: eventId, event: opts.event, createdAt: new Date().toISOString(), data: opts.payload });
  const delivery = await db.webhookDelivery.create({
    data: { webhookId: opts.webhookId, eventId, event: opts.event, payload: body, attempt: 1 },
  });
  return attemptDelivery({
    deliveryId: delivery.id,
    webhookId: opts.webhookId,
    url: opts.url,
    projectId: opts.projectId,
    storedSecret: opts.storedSecret,
    event: opts.event,
    eventId,
    body,
    attempt: 1,
  });
}

export async function retryPendingWebhooks(limit = 25) {
  const due = await db.webhookDelivery.findMany({
    where: {
      deliveredAt: null,
      nextRetryAt: { not: null, lte: new Date() },
      attempt: { lt: MAX_ATTEMPTS },
      webhook: { status: "active" },
    },
    include: { webhook: { include: { environment: { include: { project: true } } } } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
  });

  let sent = 0;
  for (const delivery of due) {
    const ok = await attemptDelivery({
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      url: delivery.webhook.url,
      projectId: delivery.webhook.environment.projectId,
      storedSecret: delivery.webhook.secret,
      event: delivery.event,
      eventId: delivery.eventId,
      body: delivery.payload,
      attempt: delivery.attempt + 1,
    });
    if (ok) sent += 1;
  }
  return { checked: due.length, sent };
}

export async function dispatchEvent(
  environmentId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
) {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { environmentId, status: "active" },
    include: { environment: { include: { project: true } } },
  });
  const interested = endpoints.filter((endpoint) => {
    try {
      return (JSON.parse(endpoint.eventsJson) as string[]).includes(event);
    } catch {
      return false;
    }
  });
  await Promise.allSettled(
    interested.map((endpoint) =>
      deliverWebhook({
        webhookId: endpoint.id,
        url: endpoint.url,
        projectId: endpoint.environment.projectId,
        storedSecret: endpoint.secret,
        event,
        payload,
      }),
    ),
  );
}
