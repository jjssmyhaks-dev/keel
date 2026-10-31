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
import { WEBHOOK_EVENTS, assertSafeWebhookUrl, generateWebhookSecret, storeWebhookSecret } from "@/lib/webhooks";

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

    let url: string;
    try {
      url = await assertSafeWebhookUrl(String(body.url || ""));
    } catch (error) {
      throw new ApiError(
        422,
        "invalid_url",
        error instanceof Error ? error.message : "Provide a valid HTTPS URL for webhook deliveries.",
      );
    }

    const known = WEBHOOK_EVENTS.map((event) => event.value) as string[];
    const events = (body.events ?? []).filter((event) => known.includes(event));
    if (!events.length) {
      throw new ApiError(422, "events_required", "Subscribe to at least one event.");
    }

    const secret = generateWebhookSecret();
    const stored = await storeWebhookSecret(auth.project.id, secret);
    const endpoint = await db.webhookEndpoint.create({
      data: {
        environmentId: auth.environment.id,
        url,
        secret: stored,
        eventsJson: JSON.stringify(events),
      },
    });

    const id = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "webhook.created",
      resourceType: "webhook",
      resourceId: endpoint.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: { url: endpoint.url, events },
    });

    return apiOk(
      {
        id: endpoint.id,
        object: "webhook_endpoint",
        url: endpoint.url,
        events,
        status: endpoint.status,
        secret,
        warning: "Copy this signing secret now. It will not be shown again.",
        createdAt: endpoint.createdAt.toISOString(),
      },
      { status: 201, requestId: id },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
