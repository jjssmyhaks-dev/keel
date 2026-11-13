import type { WebhookEndpoint } from "@prisma/client";
import { ApiError } from "../api";
import { auditEvent } from "../audit";
import {
  WEBHOOK_EVENTS,
  assertSafeWebhookUrl,
  generateWebhookSecret,
  storeWebhookSecret,
} from "../webhooks";
import { storeOf, type ServiceActor, type ServiceStore } from "./types";

export async function safeWebhookUrl(raw: string): Promise<string> {
  try {
    return await assertSafeWebhookUrl(String(raw || ""));
  } catch (error) {
    throw new ApiError(
      422,
      "invalid_url",
      error instanceof Error ? error.message : "Provide a valid HTTPS URL for webhook deliveries.",
    );
  }
}

export function normalizeWebhookEvents(input: string[]): string[] {
  const known = WEBHOOK_EVENTS.map((event) => event.value) as string[];
  const events = (input ?? []).filter((event) => known.includes(event));
  if (!events.length) {
    throw new ApiError(422, "events_required", "Subscribe to at least one event.");
  }
  return events;
}

export async function createWebhookService(
  actor: ServiceActor & { projectId: string },
  input: { url: string; events: string[] },
  store?: ServiceStore,
): Promise<{ endpoint: WebhookEndpoint; secret: string; requestId: string }> {
  const client = storeOf(store);
  const url = await safeWebhookUrl(input.url);
  const events = normalizeWebhookEvents(input.events);

  const secret = generateWebhookSecret();
  const stored = await storeWebhookSecret(actor.projectId, secret);
  const endpoint = await client.webhookEndpoint.create({
    data: {
      environmentId: actor.environmentId,
      url,
      secret: stored,
      eventsJson: JSON.stringify(events),
    },
  });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "webhook.created",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { url: endpoint.url, events },
    },
    store,
  );

  return { endpoint, secret, requestId };
}

export async function updateWebhookService(
  actor: ServiceActor,
  endpoint: WebhookEndpoint,
  input: { url?: string; events?: string[]; status?: string },
  store?: ServiceStore,
): Promise<{ endpoint: WebhookEndpoint; requestId: string; changed: string[] }> {
  const client = storeOf(store);
  const data: Record<string, unknown> = {};
  if (input.url) data.url = await safeWebhookUrl(input.url);
  if (input.events) data.eventsJson = JSON.stringify(normalizeWebhookEvents(input.events));
  if (input.status && ["active", "disabled"].includes(input.status)) data.status = input.status;
  if (!Object.keys(data).length) {
    throw new ApiError(422, "no_changes", "Provide a URL, events or status to update.");
  }

  const updated = await client.webhookEndpoint.update({ where: { id: endpoint.id }, data });
  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "webhook.updated",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { url: updated.url, events: JSON.parse(updated.eventsJson || "[]"), status: updated.status },
    },
    store,
  );

  return { endpoint: updated, requestId, changed: Object.keys(data) };
}

export async function deleteWebhookService(
  actor: ServiceActor,
  endpoint: WebhookEndpoint,
  store?: ServiceStore,
): Promise<{ requestId: string }> {
  const client = storeOf(store);
  await client.webhookEndpoint.delete({ where: { id: endpoint.id } });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "webhook.deleted",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { url: endpoint.url },
    },
    store,
  );

  return { requestId };
}
