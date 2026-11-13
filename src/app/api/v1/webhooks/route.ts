import { db } from "@/lib/db";
import {
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { createWebhookService } from "@/lib/services/webhooks";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const endpoints = await db.webhookEndpoint.findMany({
      where: { environmentId: auth.environment.id },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
    });
    return apiOk({
      object: "list",
      data: endpoints.map((endpoint) => ({
        id: endpoint.id,
        object: "webhook_endpoint",
        url: endpoint.url,
        events: JSON.parse(endpoint.eventsJson || "[]"),
        status: endpoint.status,
        lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
        createdAt: endpoint.createdAt.toISOString(),
        deliveries: endpoint.deliveries.map((delivery) => ({
          id: delivery.id,
          event: delivery.event,
          statusCode: delivery.statusCode,
          attempt: delivery.attempt,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
          error: delivery.error,
          createdAt: delivery.createdAt.toISOString(),
        })),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{ url?: string; events?: string[] }>(req);

    const { endpoint, secret, requestId } = await createWebhookService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
        projectId: auth.project.id,
      },
      { url: String(body.url || ""), events: body.events ?? [] },
    );

    return apiOk(
      {
        id: endpoint.id,
        object: "webhook_endpoint",
        url: endpoint.url,
        events: JSON.parse(endpoint.eventsJson || "[]"),
        status: endpoint.status,
        secret,
        warning: "Copy this signing secret now. It will not be shown again.",
        createdAt: endpoint.createdAt.toISOString(),
      },
      { status: 201, requestId },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
