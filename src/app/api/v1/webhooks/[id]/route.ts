import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { deleteWebhookService, updateWebhookService } from "@/lib/services/webhooks";

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

    const result = await updateWebhookService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      endpoint,
      { url: body.url, events: body.events, status: body.status },
    );

    return apiOk(
      {
        id: result.endpoint.id,
        object: "webhook_endpoint",
        url: result.endpoint.url,
        events: JSON.parse(result.endpoint.eventsJson || "[]"),
        status: result.endpoint.status,
        createdAt: result.endpoint.createdAt.toISOString(),
      },
      { requestId: result.requestId },
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

    const result = await deleteWebhookService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      endpoint,
    );

    return apiOk({ id: endpoint.id, object: "webhook_endpoint", deleted: true }, { requestId: result.requestId });
  } catch (error) {
    return handleApiError(error);
  }
}
