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
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { serializeCredential } from "@/lib/serializers";

async function loadCredential(id: string, environmentId: string) {
  const credential = await db.credential.findFirst({
    where: { id, environmentId, endUserId: null },
    include: {
      grants: { include: { agent: { select: { id: true, name: true, status: true } } } },
      healthEvents: { orderBy: { checkedAt: "desc" }, take: 10 },
    },
  });
  if (!credential) throw new ApiError(404, "credential_not_found", "No connection with that ID exists in this environment.");
  return credential;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const credential = await loadCredential(id, auth.environment.id);
    return apiOk(
      serializeCredential(credential, {
        grantedAgents: credential.grants.map((g) => ({
          id: g.agent.id,
          name: g.agent.name,
          status: g.agent.status,
        })),
        health: credential.healthEvents.map((event) => ({
          result: event.result,
          detail: event.detail,
          checkedAt: event.checkedAt.toISOString(),
        })),
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const credential = await loadCredential(id, auth.environment.id);
    const body = await parseJson<{
      name?: string;
      secret?: string | Record<string, unknown>;
      metadata?: Record<string, unknown>;
      expiresAt?: string | null;
      status?: string;
    }>(req);

    const data: Record<string, unknown> = {};
    if (body.name) data.name = String(body.name).trim().slice(0, 80);
    if (body.metadata !== undefined) data.metadataJson = JSON.stringify(body.metadata);
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.status && ["healthy", "broken", "expiring"].includes(body.status)) data.status = body.status;

    const secretChanged = body.secret !== undefined;
    if (secretChanged && credential.revokedAt) {
      throw new ApiError(409, "credential_revoked", "This connection was revoked. Create a new one instead of rotating it.");
    }
    if (secretChanged) {
      const incoming = body.secret;
      if (incoming === null || incoming === undefined) {
        throw new ApiError(422, "secret_required", "Provide the new secret value, or revoke the connection instead.");
      }
      const secret: Record<string, unknown> =
        typeof incoming === "string"
          ? {
              [credential.type === "api_key"
                ? "apiKey"
                : credential.type === "oauth"
                  ? "accessToken"
                  : "token"]: incoming,
            }
          : incoming;
      const hintSource =
        (secret.apiKey as string) ||
        (secret.token as string) ||
        (secret.accessToken as string) ||
        (secret.password as string) ||
        "";
      const sealed = await encryptSecret(auth.project.id, secret);
      data.encryptedPayload = sealed.encryptedPayload;
      data.dataKeyEncrypted = sealed.dataKeyEncrypted;
      data.maskedHint = hintSource ? `••••${String(hintSource).slice(-4)}` : credential.maskedHint;
      data.status = "unverified";
      data.healthDetail = null;
      data.healthEvents = {
        create: { result: "stored", detail: "Secret replaced. Not yet verified by a provider call." },
      };
      data.revokedAt = null;
    }

    const updated = await db.credential.update({ where: { id: credential.id }, data });

    const id2 = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: secretChanged ? "credential.rotated" : "credential.updated",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      requestId: id2,
      ip: clientIp(req),
      payloadSummary: {
        connector: credential.connectorSlug,
        name: updated.name,
        fields: Object.keys(data).filter((key) => key !== "encryptedPayload" && key !== "dataKeyEncrypted"),
      },
    });

    return apiOk(serializeCredential(updated), { requestId: id2 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const credential = await loadCredential(id, auth.environment.id);

    const updated = await db.credential.update({
      where: { id: credential.id },
      data: {
        revokedAt: new Date(),
        status: "revoked",
        encryptedPayload: "",
        dataKeyEncrypted: "",
      },
    });

    const id2 = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "credential.revoked",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      requestId: id2,
      ip: clientIp(req),
      payloadSummary: {
        connector: credential.connectorSlug,
        name: credential.name,
        revokedGrants: credential.grants.length,
      },
    });

    await dispatchEvent(auth.environment.id, "credential.expiring", {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      name: credential.name,
      state: "revoked",
    });

    return apiOk(serializeCredential(updated), { requestId: id2 });
  } catch (error) {
    return handleApiError(error);
  }
}
