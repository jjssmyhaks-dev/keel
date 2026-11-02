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
import { encryptSecret } from "@/lib/crypto";
import { connector } from "@/lib/connectors";
import { auditEvent } from "@/lib/audit";
import { serializeCredential } from "@/lib/serializers";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const connectorSlug = url.searchParams.get("connector");
    const credentials = await db.credential.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(connectorSlug ? { connectorSlug } : {}),
      },
      include: { grants: true, healthEvents: { orderBy: { checkedAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    return apiOk({
      object: "list",
      data: credentials.map((c) =>
        serializeCredential(c, {
          grantedAgents: new Set(c.grants.map((g) => g.agentId)).size,
          lastHealth: c.healthEvents[0]
            ? { result: c.healthEvents[0].result, detail: c.healthEvents[0].detail, checkedAt: c.healthEvents[0].checkedAt.toISOString() }
            : null,
        }),
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      connector?: string;
      name?: string;
      type?: string;
      secret?: string | Record<string, unknown>;
      metadata?: Record<string, unknown>;
      expiresAt?: string;
    }>(req);

    const connectorDef = body.connector ? connector(body.connector) : undefined;
    if (!connectorDef) throw new ApiError(422, "unknown_connector", "Provide a valid connector slug.");
    const name = String(body.name || connectorDef.name).trim().slice(0, 80);
    const allowedTypes = ["oauth", "api_key", "bearer", "basic"];
    const type = body.type && allowedTypes.includes(body.type) ? body.type : connectorDef.defaultAuth;

    if (body.secret === undefined) {
      throw new ApiError(422, "secret_required", "Provide the credential secret.");
    }
    if (auth.environment.type === "production" && auth.organization.plan === "free") {
      throw new ApiError(402, "plan_required", "Production mode requires a paid plan.");
    }

    let secret: Record<string, unknown>;
    if (typeof body.secret === "string") {
      const key = type === "api_key" ? "apiKey" : type === "oauth" ? "accessToken" : "token";
      secret = { [key]: body.secret };
    } else {
      secret = body.secret;
    }

    const hintSource =
      (secret.apiKey as string) ||
      (secret.token as string) ||
      (secret.accessToken as string) ||
      (secret.password as string) ||
      "";
    const maskedHint = hintSource ? `••••${String(hintSource).slice(-4)}` : "••••";

    const sealed = await encryptSecret(auth.project.id, secret);
    const credential = await db.credential.create({
      data: {
        environmentId: auth.environment.id,
        connectorSlug: connectorDef.slug,
        name,
        type,
        encryptedPayload: sealed.encryptedPayload,
        dataKeyEncrypted: sealed.dataKeyEncrypted,
        metadataJson: JSON.stringify(body.metadata ?? {}),
        maskedHint,
        status: "unverified",
        createdBy: auth.apiKeyId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        healthEvents: {
          create: { result: "stored", detail: "Stored and encrypted. Not yet verified by a provider call." },
        },
      },
    });

    const id = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "credential.created",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: { connector: connectorDef.slug, name, type, hint: maskedHint },
    });

    return apiOk(serializeCredential(credential), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
