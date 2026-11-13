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

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;

    const relationship = await db.trustRelationship.findUnique({ where: { id } });
    if (!relationship) throw new ApiError(404, "relationship_not_found", "No trust relationship with that ID exists.");
    if (relationship.externalEnvironmentId !== auth.environment.id) {
      throw new ApiError(403, "not_external_side", "Only the invited organization can decline this relationship.");
    }
    if (relationship.status === "declined") return apiOk({ id, status: "declined" });
    if (relationship.status !== "invited") {
      throw new ApiError(409, "relationship_not_invited", `This relationship is ${relationship.status}.`);
    }

    const updated = await db.trustRelationship.update({
      where: { id },
      data: { status: "declined" },
    });

    await auditEvent({
      environmentId: relationship.ownerEnvironmentId,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "trust.declined",
      resourceType: "trust",
      resourceId: id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { externalAgentId: relationship.externalAgentId },
    }).catch(() => null);
    await auditEvent({
      environmentId: relationship.externalEnvironmentId,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "trust.declined",
      resourceType: "trust",
      resourceId: id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { externalAgentId: relationship.externalAgentId },
    }).catch(() => null);

    return apiOk({ id, status: updated.status });
  } catch (error) {
    return handleApiError(error);
  }
}
