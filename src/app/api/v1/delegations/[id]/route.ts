import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, clientIp, handleApiError, requireSecretKey } from "@/lib/api";
import { auditEvent } from "@/lib/audit";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const delegation = await db.delegation.findFirst({
      where: { id, environmentId: auth.environment.id },
      include: {
        parent: { select: { name: true } },
        child: { select: { name: true } },
      },
    });
    if (!delegation) throw new ApiError(404, "delegation_not_found", "No delegation with that ID exists in this environment.");
    if (delegation.revokedAt) {
      return apiOk({ object: "delegation", id: delegation.id, revoked: true, revokedAt: delegation.revokedAt.toISOString() });
    }

    const revokedAt = new Date();
    await db.delegation.update({ where: { id: delegation.id }, data: { revokedAt } });
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: delegation.childAgentId,
      action: "delegation.revoked",
      resourceType: "delegation",
      resourceId: delegation.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { parent: delegation.parent.name, child: delegation.child.name },
    });

    return apiOk({ object: "delegation", id: delegation.id, revoked: true, revokedAt: revokedAt.toISOString() });
  } catch (error) {
    return handleApiError(error);
  }
}
