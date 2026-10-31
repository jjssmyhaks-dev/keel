import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requestId,
  requireSecretKey,
} from "@/lib/api";
import { auditEvent } from "@/lib/audit";
import { WEBHOOK_EVENTS, assertSafeWebhookUrl } from "@/lib/webhooks";

async function loadEndpoint(id: string, environmentId: string) {
  const endpoint = await db.webhookEndpoint.findFirst({ where: { id, environmentId } });
  if (!endpoint) throw new ApiError(404, "webhook_not_found", "No webhook endpoint with that ID exists.");
  return endpoint;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const endpoint = await loadEndpoint(id, auth.environment.id);
    const deliveries = await db.webhookDelivery.findMany({
      where: { webhookId: endpoint.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return apiOk({
      id: endpoint.id,
      object: "webhook_endpoint",
      url: endpoint.url,
      events: JSON.parse(endpoint.eventsJson || "[]"),
      status: endpoint.status,
      lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
      createdAt: endpoint.createdAt.toISOString(),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        eventId: delivery.eventId,
        event: delivery.event,
        statusCode: delivery.statusCode,
        attempt: delivery.attempt,
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        nextRetryAt: delivery.nextRetryAt?.toISOString() ?? null,
        error: delivery.error,
        createdAt: delivery.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const endpoint = await loadEndpoint(id, auth.environment.id);
    const body = await parseJson<{ url?: string; events?: string[]; status?: string }>(req);

    const data: Record<string, unknown> = {};
    if (body.url) {
      try {
        data.url = await assertSafeWebhookUrl(body.url);
      } catch (error) {
        throw new ApiError(
          422,
          "invalid_url",
          error instanceof Error ? error.message : "Provide a valid HTTPS URL for webhook deliveries.",
        );
      }
    }
    if (body.events) {
      const known = WEBHOOK_EVENTS.map((event) => event.value) as string[];
      const events = body.events.filter((event) => known.includes(event));
      if (!events.length) throw new ApiError(422, "events_required", "Subscribe to at least one event.");
      data.eventsJson = JSON.stringify(events);
    }
    if (body.status && ["active", "disabled"].includes(body.status)) data.status = body.status;
    if (!Object.keys(data).length) throw new ApiError(422, "no_changes", "Provide a URL, events or status to update.");

    const updated = await db.webhookEndpoint.update({ where: { id: endpoint.id }, data });
    const rid = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "webhook.updated",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: { url: updated.url, events: JSON.parse(updated.eventsJson), status: updated.status },
    });
    return apiOk(
      {
        id: updated.id,
        object: "webhook_endpoint",
        url: updated.url,
        events: JSON.parse(updated.eventsJson || "[]"),
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
      },
      { requestId: rid },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const endpoint = await loadEndpoint(id, auth.environment.id);
    await db.webhookEndpoint.delete({ where: { id: endpoint.id } });

    const rid = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "webhook.deleted",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: { url: endpoint.url },
    });
    return apiOk({ id: endpoint.id, object: "webhook_endpoint", deleted: true }, { requestId: rid });
  } catch (error) {
    return handleApiError(error);
  }
}
