import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  requireSecretKey,
} from "@/lib/api";
import { auditEvent } from "@/lib/audit";
import { serializeClientSecret } from "@/lib/serializers";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; secretId: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id, secretId } = await ctx.params;

    const agent = await db.agent.findFirst({ where: { id, environmentId: auth.environment.id } });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
    const secret = await db.agentClientSecret.findFirst({ where: { id: secretId, agentId: agent.id } });
    if (!secret) throw new ApiError(404, "client_secret_not_found", "No client secret with that ID exists for this agent.");

    const updated = secret.revokedAt
      ? secret
      : await db.agentClientSecret.update({ where: { id: secret.id }, data: { revokedAt: new Date() } });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: agent.id,
      action: "agent.client_secret.revoked",
      resourceType: "client_secret",
      resourceId: secret.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { agent: agent.name, prefix: secret.prefix, label: secret.label },
    });

    return apiOk(serializeClientSecret(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
