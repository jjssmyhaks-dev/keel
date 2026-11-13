import { ApiError, apiOk, clientIp, handleApiError } from "@/lib/api";
import { agentGrantScopes } from "@/lib/agent-secrets";
import { signAgentToken } from "@/lib/jwt";
import { DpopError, verifyDpopProof, type VerifiedDpop } from "@/lib/dpop";
import { WorkloadError, verifyWorkloadToken } from "@/lib/workload";
import { clampTtl, scopeList, scopesAllowed, stringParam, tokenParams } from "@/lib/token-http";
import { auditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

async function dpopForRequest(req: Request): Promise<VerifiedDpop | null> {
  const proof = req.headers.get("dpop");
  if (!proof) return null;
  try {
    return await verifyDpopProof({ proof, method: "POST", url: req.url });
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
    const token = stringParam(params, "token", "subject_token");
    const tokenType = stringParam(params, "subject_token_type");
    if (!token) {
      throw new ApiError(400, "invalid_request", "Provide the workload JWT as token or subject_token.");
    }
    if (tokenType && tokenType !== "urn:ietf:params:oauth:token-type:jwt") {
      throw new ApiError(
        400,
        "invalid_request",
        "subject_token_type must be urn:ietf:params:oauth:token-type:jwt for workload exchange.",
      );
    }

    let verification;
    try {
      verification = await verifyWorkloadToken(token);
    } catch (error) {
      if (error instanceof WorkloadError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
    const { identity, agent } = verification;
    if (agent.kind === "external") {
      throw new ApiError(
        422,
        "external_agent_cannot_delegate",
        "Shadow agents for cross-organization trust cannot mint workload tokens.",
      );
    }

    const rate = await consumeRateLimit(`token:workload:${identity.id}`, 120);
    if (!rate.allowed) throw new ApiError(429, "rate_limited", "Too many token requests for this workload identity.");

    const dpop = await dpopForRequest(req);
    const available = await agentGrantScopes(agent.id);
    const requested = scopeList(params.scope ?? params.scopes);
    if (requested.length && !scopesAllowed(available, requested)) {
      throw new ApiError(400, "invalid_scope", "Requested scopes exceed this agent's active grants.");
    }
    const scopes = requested.length ? requested : available;
    const ttl = Math.min(identity.tokenTtlSeconds || 300, clampTtl(params.ttl, identity.tokenTtlSeconds || 300));

    const environment = identity.environment;
    const issued = await signAgentToken(
      {
        agentId: agent.id,
        environmentId: environment.id,
        projectId: environment.project.id,
        organizationId: environment.project.org.id,
        principalId: agent.ownerUserId,
        scopes,
      },
      ttl,
      {
        cnf: dpop ? { jkt: dpop.jkt } : null,
        clientId: `workload:${identity.id}`,
        scopeEnforced: true,
      },
    );

    await auditEvent({
      environmentId: environment.id,
      actorType: "agent",
      actorId: agent.id,
      actorName: agent.name,
      agentId: agent.id,
      action: "token.issued",
      resourceType: "token",
      resourceId: issued.tokenId,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        method: "workload_identity",
        workloadIdentityId: identity.id,
        workloadSubject: String(verification.claims.sub ?? ""),
        issuer: identity.issuer,
        scopes,
        dpop: Boolean(dpop),
      },
    });

    return apiOk({
      access_token: issued.token,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: dpop ? "DPoP" : "Bearer",
      expires_in: issued.expiresIn,
      scope: scopes.join(" "),
      token_id: issued.tokenId,
      workload_identity: { id: identity.id, name: identity.name, issuer: identity.issuer },
      agent: { id: agent.id, name: agent.name },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
