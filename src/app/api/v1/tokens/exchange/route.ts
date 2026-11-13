import { db } from "@/lib/db";
import { ApiError, apiOk, clientIp, handleApiError } from "@/lib/api";
import { agentGrantScopes } from "@/lib/agent-secrets";
import { MAX_DELEGATION_DEPTH, restrictionsFromJson, scopeListFromJson, verifyDelegationClaims } from "@/lib/delegations";
import { signAgentToken, verifyAgentToken, AUDIENCE } from "@/lib/jwt";
import { DpopError, verifyDpopProof, type VerifiedDpop } from "@/lib/dpop";
import { clampTtl, intersectScopes, scopeList, scopesAllowed, stringParam, tokenParams } from "@/lib/token-http";
import { auditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

async function proofFor(req: Request, accessToken: string) {
  const proof = req.headers.get("dpop");
  if (!proof) return null;
  try {
    return await verifyDpopProof({ proof, method: "POST", url: req.url, accessToken });
  } catch (error) {
    if (error instanceof DpopError) {
      throw new ApiError(400, "invalid_dpop_proof", error.message, { dpopError: error.code });
    }
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const params = await tokenParams(req);
    const subjectToken = stringParam(params, "subject_token");
    const subjectTokenType = stringParam(params, "subject_token_type");

    if (!subjectToken) {
      throw new ApiError(400, "invalid_request", "Provide the caller's access token as subject_token.");
    }
    if (subjectTokenType && subjectTokenType !== ACCESS_TOKEN_TYPE) {
      throw new ApiError(400, "invalid_request", `subject_token_type must be ${ACCESS_TOKEN_TYPE}.`);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await verifyAgentToken(subjectToken)) as Record<string, unknown>;
    } catch {
      throw new ApiError(401, "invalid_token", "The subject token is invalid or expired.");
    }

    const parentJti = String(payload.jti ?? "");
    const subjectAgentId = String(payload.sub ?? "");
    if (!parentJti || !subjectAgentId) {
      throw new ApiError(401, "invalid_token", "The subject token is missing required claims.");
    }
    const blocked = await db.tokenBlocklist.findUnique({ where: { id: parentJti } });
    if (blocked) throw new ApiError(401, "token_revoked", "The subject token has been revoked.");

    const subjectAgent = await db.agent.findUnique({
      where: { id: subjectAgentId },
      include: { environment: { include: { project: { include: { org: true } } } } },
    });
    if (!subjectAgent) throw new ApiError(401, "unknown_agent", "The subject agent no longer exists.");
    if (subjectAgent.status !== "active") {
      throw new ApiError(403, "agent_inactive", `Agent is ${subjectAgent.status}. Resume it to issue tokens.`);
    }
    if (String(payload.env ?? "") !== subjectAgent.environmentId) {
      throw new ApiError(401, "environment_mismatch", "The subject token belongs to a different environment.");
    }
    if (subjectAgent.environment.project.org.deletedAt) {
      throw new ApiError(403, "organization_suspended", "This organization is suspended.");
    }
    if (subjectAgent.kind === "external" || payload.x_org === true) {
      throw new ApiError(
        422,
        "external_agent_cannot_delegate",
        "Cross-organization shadow agents cannot exchange or delegate tokens.",
      );
    }
    const consentClaim = typeof payload.consent === "string" ? payload.consent : null;
    const endUserClaim =
      payload.end_user && typeof payload.end_user === "object"
        ? (payload.end_user as Record<string, unknown>)
        : null;

    const delegationClaims = await verifyDelegationClaims(payload, subjectAgent.environmentId);
    if (!delegationClaims.ok) {
      throw new ApiError(401, delegationClaims.code, delegationClaims.message);
    }

    const rate = await consumeRateLimit(`token:exchange:${subjectAgent.id}`, 120);
    if (!rate.allowed) throw new ApiError(429, "rate_limited", "Too many token exchanges for this agent.");

    const parentCnf = payload.cnf as { jkt?: unknown } | undefined;
    const parentJkt = typeof parentCnf?.jkt === "string" ? parentCnf.jkt : null;
    let dpop: VerifiedDpop | null = null;
    if (parentJkt) {
      const proof = req.headers.get("dpop");
      if (!proof) {
        throw new ApiError(400, "dpop_required", "The subject token is DPoP-bound. Include a DPoP proof header.");
      }
      try {
        dpop = await verifyDpopProof({
          proof,
          method: "POST",
          url: req.url,
          accessToken: subjectToken,
          expectedJkt: parentJkt,
        });
      } catch (error) {
        if (error instanceof DpopError) throw new ApiError(400, "invalid_dpop_proof", error.message);
        throw error;
      }
    } else {
      dpop = await proofFor(req, subjectToken);
    }

    const targetAgentId = stringParam(params, "agent_id");
    let targetAgent = subjectAgent;
    let activeDelegation: { id: string; scopesJson: string; restrictionsJson: string } | null = null;
    if (targetAgentId && targetAgentId !== subjectAgent.id) {
      if (consentClaim) {
        throw new ApiError(
          422,
          "consent_token_cannot_delegate",
          "A consent token only acts for its own agent. Exchange it without agent_id.",
        );
      }
      const found = await db.agent.findFirst({
        where: { id: targetAgentId, environmentId: subjectAgent.environmentId },
        include: { environment: { include: { project: { include: { org: true } } } } },
      });
      if (!found) throw new ApiError(404, "unknown_agent", "The requested agent does not exist in this environment.");
      if (found.status !== "active") {
        throw new ApiError(403, "agent_inactive", `Agent ${found.name} is ${found.status} and cannot receive a delegated token.`);
      }
      if (delegationClaims.parentChain.length >= MAX_DELEGATION_DEPTH) {
        throw new ApiError(
          400,
          "delegation_depth_exceeded",
          `Delegation chains are limited to ${MAX_DELEGATION_DEPTH} exchanges.`,
        );
      }
      activeDelegation = await db.delegation.findFirst({
        where: {
          environmentId: subjectAgent.environmentId,
          parentAgentId: subjectAgent.id,
          childAgentId: found.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, scopesJson: true, restrictionsJson: true },
      });
      if (!activeDelegation) {
        throw new ApiError(
          403,
          "delegation_required",
          `Create a delegation from ${subjectAgent.name} to ${found.name} before exchanging a token for it.`,
        );
      }
      targetAgent = found;
    }

    const parentScopes = Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [];
    const parentEnforced = payload.scope_enforced === true;
    const subjectScopes =
      !parentEnforced && parentScopes.length === 0 ? await agentGrantScopes(subjectAgent.id) : parentScopes;
    const delegatedScopes = activeDelegation ? scopeListFromJson(activeDelegation.scopesJson) : null;
    if (activeDelegation && delegatedScopes && delegatedScopes.length === 0) {
      throw new ApiError(403, "delegation_empty", "This delegation does not grant any scopes.");
    }

    const available =
      targetAgent.id === subjectAgent.id
        ? subjectScopes
        : intersectScopes(
            intersectScopes(subjectScopes, await agentGrantScopes(targetAgent.id)),
            delegatedScopes ?? [],
          );

    const requested = scopeList(params.scope ?? params.scopes);
    if (requested.length && !scopesAllowed(available, requested)) {
      throw new ApiError(400, "invalid_scope", "Requested scopes exceed what the caller and target agent can use.");
    }
    const scopes = requested.length ? requested : available;

    const parentExp = Number(payload.exp);
    const remaining = Number.isFinite(parentExp) ? parentExp - Math.floor(Date.now() / 1000) : 300;
    if (remaining < 30) {
      throw new ApiError(401, "invalid_token", "The subject token is about to expire. Request a fresh token first.");
    }
    const maxTtlSeconds = activeDelegation
      ? Number(restrictionsFromJson(activeDelegation.restrictionsJson).maxTtlSeconds)
      : NaN;
    const ttlLimit =
      Number.isFinite(maxTtlSeconds) && maxTtlSeconds > 0 ? Math.floor(maxTtlSeconds) : Number.POSITIVE_INFINITY;
    const ttl = Math.max(1, Math.min(clampTtl(params.ttl), remaining, ttlLimit));

    const parentActor =
      payload.actor && typeof payload.actor === "object" ? (payload.actor as Record<string, unknown>) : null;
    const unrelatedParentActor =
      parentActor && parentActor.sub !== subjectAgent.id
        ? parentActor
        : parentActor && parentActor.act && typeof parentActor.act === "object"
          ? (parentActor.act as Record<string, unknown>)
          : null;
    const actor =
      targetAgent.id === subjectAgent.id
        ? parentActor ?? { sub: subjectAgent.id }
        : { sub: subjectAgent.id, ...(unrelatedParentActor ? { act: unrelatedParentActor } : {}) };

    const issued = await signAgentToken(
      {
        agentId: targetAgent.id,
        environmentId: subjectAgent.environmentId,
        projectId: subjectAgent.environment.project.id,
        organizationId: subjectAgent.environment.project.org.id,
        principalId: typeof payload.principal === "string" ? payload.principal : targetAgent.ownerUserId,
        scopes,
        chain: Array.isArray(payload.chain) ? (payload.chain as { agentId: string; name: string }[]) : [],
      },
      ttl,
      {
        audience: AUDIENCE,
        cnf: dpop ? { jkt: dpop.jkt } : parentJkt ? { jkt: parentJkt } : null,
        actor,
        clientId: typeof payload.client_id === "string" ? payload.client_id : subjectAgent.id,
        parentJti,
        parentChain:
          targetAgent.id === subjectAgent.id
            ? delegationClaims.parentChain
            : [parentJti, ...delegationClaims.parentChain].slice(0, MAX_DELEGATION_DEPTH),
        delegationId: targetAgent.id === subjectAgent.id ? delegationClaims.delegationId : activeDelegation?.id ?? null,
        scopeEnforced: true,
        ...(consentClaim || endUserClaim
          ? {
              extraClaims: {
                ...(endUserClaim ? { end_user: endUserClaim } : {}),
                ...(consentClaim ? { consent: consentClaim } : {}),
              },
            }
          : {}),
      },
    );

    await auditEvent({
      environmentId: subjectAgent.environmentId,
      actorType: "agent",
      actorId: subjectAgent.id,
      actorName: subjectAgent.name,
      agentId: targetAgent.id,
      action: "token.exchanged",
      resourceType: "token",
      resourceId: issued.tokenId,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        parentTokenId: parentJti,
        subjectAgent: subjectAgent.id,
        targetAgent: targetAgent.id,
        delegationId: targetAgent.id === subjectAgent.id ? delegationClaims.delegationId : activeDelegation?.id ?? null,
        scopes,
        dpop: Boolean(dpop || parentJkt),
        ...(consentClaim ? { consentId: consentClaim } : {}),
        ...(endUserClaim ? { endUserId: String(endUserClaim.id ?? "") } : {}),
      },
    });

    return apiOk({
      access_token: issued.token,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: dpop || parentJkt ? "DPoP" : "Bearer",
      expires_in: issued.expiresIn,
      scope: scopes.join(" "),
      token_id: issued.tokenId,
      parent_token_id: parentJti,
      delegation_id: targetAgent.id === subjectAgent.id ? delegationClaims.delegationId : activeDelegation?.id ?? null,
      act: actor,
      agent: { id: targetAgent.id, name: targetAgent.name },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
