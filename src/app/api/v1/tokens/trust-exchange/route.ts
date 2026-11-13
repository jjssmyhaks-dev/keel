import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateAgent,
  clientIp,
  handleApiError,
  parseJson,
} from "@/lib/api";
import { auditEvent } from "@/lib/audit";
import { signAgentToken } from "@/lib/jwt";
import { consumeRateLimit } from "@/lib/rate-limit";
import { parseStringArray } from "@/lib/consent";
import {
  TRUST_TOKEN_TTL_SECONDS,
  intersectTrustScopes,
  normalizeTrustScopes,
} from "@/lib/trust-engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await authenticateAgent(req);
    const caller = auth.agent;
    const limit = await consumeRateLimit(`trust-exchange:${caller.id}`, 120);
    if (!limit.allowed) throw new ApiError(429, "rate_limited", "Too many trust exchange requests.");

    const body = await parseJson<{ trustRelationshipId?: string; scopes?: unknown; ttl?: number }>(req);
    const relationshipId = String(body.trustRelationshipId ?? "").trim();
    if (!relationshipId) {
      throw new ApiError(422, "trust_relationship_required", "Provide the trust relationship id.");
    }

    const relationship = await db.trustRelationship.findUnique({ where: { id: relationshipId } });
    if (!relationship) throw new ApiError(404, "trust_not_found", "No trust relationship with that ID exists.");
    if (relationship.externalAgentId !== caller.id) {
      throw new ApiError(403, "not_external_agent", "This token does not belong to the external agent of the relationship.");
    }
    if (relationship.status !== "active" || !relationship.shadowAgentId) {
      throw new ApiError(409, "trust_inactive", `The trust relationship is ${relationship.status}.`);
    }
    if (caller.status !== "active") {
      throw new ApiError(409, "agent_inactive", `The external agent is ${caller.status}.`);
    }

    const shadow = await db.agent.findUnique({
      where: { id: relationship.shadowAgentId },
      include: { environment: { include: { project: { include: { org: true } } } } },
    });
    if (!shadow) throw new ApiError(409, "shadow_agent_missing", "The shadow agent no longer exists.");
    if (shadow.status !== "active") {
      throw new ApiError(409, "shadow_agent_inactive", `The shadow agent is ${shadow.status}.`);
    }
    if (shadow.environmentId !== relationship.ownerEnvironmentId) {
      throw new ApiError(409, "trust_environment_mismatch", "The shadow agent is not in the owner environment.");
    }

    const grants = await db.grant.findMany({
      where: {
        agentId: shadow.id,
        environmentId: shadow.environmentId,
        endUserId: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { actionsJson: true },
    });
    const grantScopes = [...new Set(grants.flatMap((grant) => parseStringArray(grant.actionsJson)))];
    const scopes = intersectTrustScopes({
      grantScopes,
      maxScopes: parseStringArray(relationship.maxScopesJson),
      requested: normalizeTrustScopes(body.scopes),
    });
    if (!scopes.length) {
      throw new ApiError(422, "no_scopes", "The shadow agent has no grant that survives the relationship's scope cap.");
    }

    const ttl = Math.min(Math.max(Number(body.ttl || TRUST_TOKEN_TTL_SECONDS), 60), TRUST_TOKEN_TTL_SECONDS);
    const issued = await signAgentToken(
      {
        agentId: shadow.id,
        environmentId: shadow.environmentId,
        projectId: shadow.environment.projectId,
        organizationId: shadow.environment.project.orgId,
        principalId: null,
        scopes,
      },
      ttl,
      {
        scopeEnforced: true,
        actor: {
          sub: shadow.id,
          act: { sub: caller.id, env: relationship.externalEnvironmentId },
        },
        extraClaims: { x_org: true, trust: relationship.id },
      },
    );

    await auditEvent({
      environmentId: shadow.environmentId,
      actorType: "agent",
      actorId: caller.id,
      actorName: `${shadow.name} (via ${shadow.externalOrgName ?? "external organization"})`,
      agentId: shadow.id,
      action: "token.issued",
      resourceType: "token",
      resourceId: issued.tokenId,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        ttl,
        scopes,
        crossOrg: {
          externalAgentId: caller.id,
          externalOrgName: shadow.externalOrgName,
          trustRelationshipId: relationship.id,
        },
      },
    }).catch(() => null);

    return apiOk({
      access_token: issued.token,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      expires_at: issued.expiresAt,
      token_id: issued.tokenId,
      scope: scopes.join(" "),
      scopes,
      trust: relationship.id,
      x_org: true,
      agent: { id: shadow.id, name: shadow.name, environmentId: shadow.environmentId },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
