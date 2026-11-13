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
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import {
  TRUST_MAX_NOTE_LENGTH,
  normalizeTrustScopes,
  notifyTrustAdmins,
  trustRelationshipView,
} from "@/lib/trust-engine";
import { visibilityOf } from "@/lib/identity-document";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const side = new URL(req.url).searchParams.get("side") ?? "owner";
    if (side !== "owner" && side !== "external") {
      throw new ApiError(422, "invalid_side", "side must be owner or external.");
    }

    const relationships = await db.trustRelationship.findMany({
      where: side === "owner" ? { ownerEnvironmentId: auth.environment.id } : { externalEnvironmentId: auth.environment.id },
      orderBy: { invitedAt: "desc" },
      take: 100,
    });

    const agentIds = [
      ...new Set(
        relationships.flatMap((row) => [row.externalAgentId, row.shadowAgentId].filter((id): id is string => Boolean(id))),
      ),
    ];
    const agents = agentIds.length
      ? await db.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, status: true, environmentId: true, externalOrgName: true },
        })
      : [];
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const externalEnvIds = [...new Set(relationships.map((row) => row.externalEnvironmentId))];
    const externalEnvs = externalEnvIds.length
      ? await db.environment.findMany({
          where: { id: { in: externalEnvIds } },
          select: { id: true, project: { select: { org: { select: { name: true } } } } },
        })
      : [];
    const orgByEnv = new Map(externalEnvs.map((env) => [env.id, env.project.org.name]));

    const items = relationships.map((relationship) => {
      const shadow = relationship.shadowAgentId ? byId.get(relationship.shadowAgentId) : null;
      return trustRelationshipView({
        relationship,
        externalAgent: byId.get(relationship.externalAgentId) ?? null,
        externalOrgName: orgByEnv.get(relationship.externalEnvironmentId) ?? null,
        shadowAgent: shadow ? { id: shadow.id, name: shadow.name, status: shadow.status } : null,
      });
    });

    return apiOk({ side, relationships: items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      externalAgentId?: string;
      note?: string;
      maxScopes?: unknown;
    }>(req);
    const externalAgentId = String(body.externalAgentId ?? "").trim();
    if (!externalAgentId) {
      throw new ApiError(422, "external_agent_required", "Provide the external agent's id.");
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, TRUST_MAX_NOTE_LENGTH) : null;
    const maxScopes = normalizeTrustScopes(body.maxScopes);

    const external = await db.agent.findUnique({
      where: { id: externalAgentId },
      include: { environment: { include: { project: { include: { org: true } } } } },
    });
    if (!external) throw new ApiError(404, "agent_not_found", "No agent with that ID exists.");
    if (external.kind !== "internal") {
      throw new ApiError(422, "agent_not_internal", "Only internal agents can be invited into a trust relationship.");
    }
    if (external.status !== "active") {
      throw new ApiError(422, "agent_inactive", `The external agent is ${external.status}.`);
    }
    if (visibilityOf(external.verificationVisibility) === "private") {
      throw new ApiError(422, "agent_private", "This agent is private and cannot receive trust invitations.");
    }
    if (external.environment.type !== auth.environment.type) {
      throw new ApiError(
        422,
        "environment_mismatch",
        "Both environments must be the same type. Production trusts production; development trusts development.",
      );
    }
    if (external.environment.project.orgId === auth.organization.id) {
      throw new ApiError(422, "same_organization", "An agent cannot be invited into its own organization.");
    }

    const existing = await db.trustRelationship.findUnique({
      where: {
        ownerEnvironmentId_externalAgentId: {
          ownerEnvironmentId: auth.environment.id,
          externalAgentId: external.id,
        },
      },
    });
    if (existing && (existing.status === "invited" || existing.status === "active")) {
      throw new ApiError(409, "relationship_exists", "A relationship with this agent is already open. Revoke it first.");
    }

    const data = {
      ownerEnvironmentId: auth.environment.id,
      externalAgentId: external.id,
      externalEnvironmentId: external.environmentId,
      shadowAgentId: null,
      status: "invited",
      maxScopesJson: JSON.stringify(maxScopes),
      note,
      invitedBy: auth.apiKeyId,
      invitedAt: new Date(),
      acceptedBy: null,
      acceptedAt: null,
      revokedBy: null,
      revokedAt: null,
    };
    const relationship = existing
      ? await db.trustRelationship.update({ where: { id: existing.id }, data })
      : await db.trustRelationship.create({ data });

    const externalOrg = external.environment.project.org;
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "trust.invited",
      resourceType: "trust",
      resourceId: relationship.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        externalAgentId: external.id,
        externalEnvironmentId: external.environmentId,
        externalOrgName: externalOrg.name,
        maxScopes,
      },
    }).catch(() => null);
    await dispatchEvent(auth.environment.id, "trust.invited", {
      trustRelationshipId: relationship.id,
      externalAgentId: external.id,
      externalAgentName: external.name,
      externalOrgName: externalOrg.name,
      note,
    }).catch(() => null);

    await notifyTrustAdmins({
      externalOrgId: externalOrg.id,
      externalOrgName: externalOrg.name,
      ownerOrgName: auth.organization.name,
      externalAgentName: external.name,
      note,
    }).catch(() => null);

    return apiOk(
      {
        id: relationship.id,
        status: relationship.status,
        externalAgentId: relationship.externalAgentId,
        externalEnvironmentId: relationship.externalEnvironmentId,
        maxScopes,
        note: relationship.note,
        invitedAt: relationship.invitedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
