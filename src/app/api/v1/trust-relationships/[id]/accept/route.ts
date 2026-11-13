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
import { issueIdentityDocumentSafe } from "@/lib/identity-document";
import { serializeAgent } from "@/lib/serializers";
import { shadowAgentName } from "@/lib/trust-engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;

    const relationship = await db.trustRelationship.findUnique({ where: { id } });
    if (!relationship) throw new ApiError(404, "relationship_not_found", "No trust relationship with that ID exists.");
    if (relationship.externalEnvironmentId !== auth.environment.id) {
      throw new ApiError(403, "not_external_side", "Only the invited organization can accept this relationship.");
    }
    if (relationship.status === "active") {
      const shadow = relationship.shadowAgentId
        ? await db.agent.findUnique({ where: { id: relationship.shadowAgentId } })
        : null;
      return apiOk({ id, status: "active", shadowAgent: shadow ? serializeAgent(shadow) : null });
    }
    if (relationship.status !== "invited") {
      throw new ApiError(409, "relationship_not_invited", `This relationship is ${relationship.status}.`);
    }

    const [external, ownerEnvironment] = await Promise.all([
      db.agent.findUnique({ where: { id: relationship.externalAgentId } }),
      db.environment.findUnique({
        where: { id: relationship.ownerEnvironmentId },
        include: { project: { include: { org: true } } },
      }),
    ]);
    if (!external) throw new ApiError(409, "agent_not_found", "The external agent no longer exists.");
    if (external.status !== "active") {
      throw new ApiError(409, "agent_inactive", `The external agent is ${external.status} and cannot accept trust.`);
    }
    if (!ownerEnvironment) throw new ApiError(409, "owner_environment_missing", "The owner environment no longer exists.");

    const externalOrg = auth.organization;
    const ownerOrg = ownerEnvironment.project.org;

    const { shadow, updated } = await db.$transaction(async (tx) => {
      const shadow = await tx.agent.create({
        data: {
          environmentId: ownerEnvironment.id,
          name: shadowAgentName(external.name, externalOrg.name),
          description: `Cross-organization agent from ${externalOrg.name}. Managed through a trust relationship.`,
          status: "active",
          agentType: external.agentType,
          kind: "external",
          externalAgentId: external.id,
          externalEnvironmentId: external.environmentId,
          externalOrgName: externalOrg.name,
          verificationVisibility: external.verificationVisibility === "private" ? "public" : external.verificationVisibility,
          publicKey: null,
          fingerprint: external.fingerprint,
          keyMode: "external",
          ownerUserId: null,
        },
      });
      const updated = await tx.trustRelationship.update({
        where: { id: relationship.id },
        data: {
          status: "active",
          shadowAgentId: shadow.id,
          acceptedBy: auth.apiKeyId,
          acceptedAt: new Date(),
        },
      });
      return { shadow, updated };
    });

    await auditEvent({
      environmentId: ownerEnvironment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: shadow.id,
      action: "trust.accepted",
      resourceType: "trust",
      resourceId: relationship.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        externalAgentId: external.id,
        externalOrgName: externalOrg.name,
        ownerOrgName: ownerOrg.name,
        shadowAgentId: shadow.id,
      },
    }).catch(() => null);
    await auditEvent({
      environmentId: external.environmentId,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: external.id,
      action: "trust.accepted",
      resourceType: "trust",
      resourceId: relationship.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { ownerOrgName: ownerOrg.name, shadowAgentId: shadow.id },
    }).catch(() => null);

    await dispatchEvent(ownerEnvironment.id, "trust.accepted", {
      trustRelationshipId: relationship.id,
      externalAgentId: external.id,
      externalOrgName: externalOrg.name,
      shadowAgentId: shadow.id,
    }).catch(() => null);
    await dispatchEvent(external.environmentId, "trust.accepted", {
      trustRelationshipId: relationship.id,
      ownerOrgName: ownerOrg.name,
      shadowAgentId: shadow.id,
    }).catch(() => null);

    await issueIdentityDocumentSafe(shadow.id).catch(() => null);

    return apiOk({
      id: updated.id,
      status: updated.status,
      shadowAgentId: shadow.id,
      shadowAgent: serializeAgent(shadow),
      acceptedAt: updated.acceptedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
