import { ApiError, apiOk, clientIp, handleApiError } from "@/lib/api";
import { ClientSecretError, agentGrantScopes, authenticateClientSecret } from "@/lib/agent-secrets";
import { signAgentToken } from "@/lib/jwt";
import { DpopError, verifyDpopProof, type VerifiedDpop } from "@/lib/dpop";
import { basicClientCredentials, clampTtl, scopeList, scopesAllowed, stringParam, tokenParams } from "@/lib/token-http";
import { auditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";

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
    const basic = basicClientCredentials(req);
    const clientId = basic?.clientId || stringParam(params, "client_id", "agent_id");
    const clientSecret = basic?.clientSecret || stringParam(params, "client_secret");

    if (!clientId || !clientSecret) {
      throw new ApiError(
        401,
        "invalid_client",
        "Provide client_id and client_secret in the body, or use HTTP Basic authentication.",
      );
    }

    let context;
    try {
      context = await authenticateClientSecret(clientSecret);
    } catch (error) {
      if (error instanceof ClientSecretError) throw new ApiError(401, error.code, error.message);
      throw error;
    }
    if (context.agent.id !== clientId) {
      throw new ApiError(401, "invalid_client", "The client secret does not belong to this client_id.");
    }
    if (context.agent.kind === "external") {
      throw new ApiError(
        422,
        "external_agent_has_no_keys",
        "Shadow agents never hold client secrets. The external organization must use trust-exchange.",
      );
    }

    const rate = await consumeRateLimit(`token:client:${context.agent.id}`, 120);
    if (!rate.allowed) throw new ApiError(429, "rate_limited", "Too many token requests for this agent.");

    const dpop = await dpopForRequest(req);

    let secretScopes: string[] = [];
    try {
      secretScopes = JSON.parse(context.secret.scopesJson || "[]") as string[];
    } catch {
      secretScopes = [];
    }
    const available = secretScopes.length ? secretScopes : await agentGrantScopes(context.agent.id);
    const requested = scopeList(params.scope ?? params.scopes);
    if (requested.length && !scopesAllowed(available, requested)) {
      throw new ApiError(400, "invalid_scope", "Requested scopes exceed what this client secret can obtain.");
    }
    const scopes = requested.length ? requested : available;

    const environment = context.environment;
    const issued = await signAgentToken(
      {
        agentId: context.agent.id,
        environmentId: environment.id,
        projectId: environment.project.id,
        organizationId: environment.project.org.id,
        principalId: context.agent.ownerUserId,
        scopes,
      },
      clampTtl(params.ttl ?? params.expires_in),
      {
        cnf: dpop ? { jkt: dpop.jkt } : null,
        clientId: context.agent.id,
        scopeEnforced: true,
      },
    );

    await auditEvent({
      environmentId: environment.id,
      actorType: "agent",
      actorId: context.agent.id,
      actorName: context.agent.name,
      agentId: context.agent.id,
      action: "token.issued",
      resourceType: "token",
      resourceId: issued.tokenId,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        method: "client_credentials",
        scopes,
        dpop: Boolean(dpop),
        clientSecretPrefix: context.secret.prefix,
      },
    });

    return apiOk({
      access_token: issued.token,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: dpop ? "DPoP" : "Bearer",
      expires_in: issued.expiresIn,
      scope: scopes.join(" "),
      token_id: issued.tokenId,
      agent: { id: context.agent.id, name: context.agent.name },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
