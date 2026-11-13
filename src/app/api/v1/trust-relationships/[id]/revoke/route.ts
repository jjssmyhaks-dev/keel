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
import { dispatchEvent } from "@/lib/webhooks";
import { recordRevocation } from "@/lib/revocations";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;

    const relationship = await db.trustRelationship.findUnique({ where: { id } });
    if (!relationship) throw new ApiError(404, "relationship_not_found", "No trust relationship with that ID exists.");
    const side =
      relationship.ownerEnvironmentId === auth.environment.id
        ? "owner"
        : relationship.externalEnvironmentId === auth.environment.id
          ? "external"
          : null;
    if (!side) {
      throw new ApiError(403, "not_a_party", "Only the two organizations in this relationship can revoke it.");
    }
    if (relationship.status === "revoked") {
      return apiOk({ id, status: "revoked", alreadyRevoked: true });
    }

    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.trustRelationship.update({
        where: { id },
        data: { status: "revoked", revokedBy: auth.apiKeyId, revokedAt: now },
      });
      if (relationship.shadowAgentId) {
        await tx.agent.updateMany({
          where: { id: relationship.shadowAgentId },
          data: { status: "revoked" },
        });
      }
    });
    if (relationship.shadowAgentId) {
      await recordRevocation(relationship.shadowAgentId, relationship.ownerEnvironmentId, "owner_revoked");
    }

    for (const environmentId of [relationship.ownerEnvironmentId, relationship.externalEnvironmentId]) {
      await auditEvent({
        environmentId,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        action: "trust.revoked",
        resourceType: "trust",
        resourceId: id,
        outcome: "recorded",
        ip: clientIp(req),
        payloadSummary: {
          externalAgentId: relationship.externalAgentId,
          shadowAgentId: relationship.shadowAgentId,
          revokedBySide: side,
        },
      }).catch(() => null);
      await dispatchEvent(environmentId, "trust.revoked", {
        trustRelationshipId: id,
        externalAgentId: relationship.externalAgentId,
        shadowAgentId: relationship.shadowAgentId,
        revokedBySide: side,
      }).catch(() => null);
    }

    return apiOk({ id, status: "revoked", revokedAt: now.toISOString() });
  } catch (error) {
    return handleApiError(error);
  }
}
