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
import { checkPlanLimit, productionAccess } from "@/lib/limits";

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
    if (auth.environment.type === "production") {
      const access = productionAccess(auth.organization.plan);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }
    const quota = await checkPlanLimit(auth.organization.id, "credentials", auth.organization.plan);
    if (!quota.allowed) {
      throw new ApiError(402, "plan_limit_reached", quota.message, {
        used: quota.used,
        limit: quota.limit,
        plan: quota.plan,
      });
    }

    let secret: Record<string, unknown>;
    if (typeof body.secret === "string") {
      if (!body.secret.trim()) throw new ApiError(422, "secret_required", "Provide a non-empty credential secret.");
      const key = type === "api_key" ? "apiKey" : type === "oauth" ? "accessToken" : "token";
      secret = { [key]: body.secret };
    } else {
      secret = body.secret;
    }

    const present = (key: string) => String(secret[key] ?? "").trim().length > 0;
    if (!Object.keys(secret).some(present)) {
      throw new ApiError(422, "secret_required", "Provide at least one non-empty credential field.");
    }
    const requiredFields = (connectorDef.credentialFields ?? []).filter((field) => field.required);
    const missing = requiredFields.map((field) => field.key).filter((key) => !present(key));
    if (missing.length) {
      throw new ApiError(422, "field_required", `Missing required fields for ${connectorDef.name}: ${missing.join(", ")}.`, {
        fields: missing,
      });
    }
    const requireAny = connectorDef.requireAnyFields ?? [];
    if (requireAny.length && !requireAny.some(present)) {
      throw new ApiError(422, "field_required", `Provide at least one of: ${requireAny.join(", ")}.`, {
        fields: requireAny,
      });
    }
    if (body.expiresAt && Number.isNaN(new Date(body.expiresAt).getTime())) {
      throw new ApiError(422, "invalid_expiry", "expiresAt must be a valid ISO date.");
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
