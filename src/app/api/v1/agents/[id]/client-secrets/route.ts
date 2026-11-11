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
import { agentGrantScopes, issueClientSecret } from "@/lib/agent-secrets";
import { scopeList, scopesAllowed } from "@/lib/token-http";
import { auditEvent } from "@/lib/audit";
import { serializeClientSecret } from "@/lib/serializers";

async function loadAgent(id: string, environmentId: string) {
  const agent = await db.agent.findFirst({ where: { id, environmentId } });
  if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
  return agent;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const agent = await loadAgent(id, auth.environment.id);
    const secrets = await db.agentClientSecret.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" },
    });
    return apiOk({
      object: "list",
      data: secrets.map((secret) => serializeClientSecret(secret)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const agent = await loadAgent(id, auth.environment.id);
    if (agent.status === "revoked") {
      throw new ApiError(409, "agent_revoked", "Revocation is permanent. Create a new agent before issuing secrets.");
    }

    const body = await parseJson<{
      label?: string;
      scopes?: string[] | string;
      expiresInDays?: number;
    }>(req);

    const requested = scopeList(body.scopes);
    if (requested.length) {
      const available = await agentGrantScopes(agent.id);
      if (!scopesAllowed(available, requested)) {
        throw new ApiError(
          422,
          "invalid_scope",
          "Client secret scopes must be covered by this agent's active grants.",
          { available },
        );
      }
    }

    let expiresAt: Date | null = null;
    if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
      const days = Number(body.expiresInDays);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        throw new ApiError(422, "invalid_expiry", "expiresInDays must be between 1 and 365.");
      }
      expiresAt = new Date(Date.now() + Math.floor(days) * 86_400_000);
    }

    const { secret, raw } = await issueClientSecret({
      agentId: agent.id,
      label: body.label,
      scopes: requested,
      expiresAt,
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: agent.id,
      action: "agent.client_secret.created",
      resourceType: "client_secret",
      resourceId: secret.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        agent: agent.name,
        label: secret.label,
        prefix: secret.prefix,
        scopes: requested,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });

    return apiOk(
      {
        ...serializeClientSecret(secret),
        secret: raw,
        warning: "Store this secret now. It is shown once and only a hash is kept.",
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
