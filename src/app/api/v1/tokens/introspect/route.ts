import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, parseJson } from "@/lib/api";
import { verifyAgentToken } from "@/lib/jwt";
import { verifyDelegationClaims } from "@/lib/delegations";

export async function POST(req: Request) {
  try {
    await authenticateApiKey(req);
    const body = await parseJson<{ token?: string }>(req);
    if (!body.token) throw new ApiError(422, "token_required", "Provide the agent token to introspect.");

    let payload: Record<string, unknown>;
    try {
      payload = (await verifyAgentToken(body.token)) as Record<string, unknown>;
    } catch {
      return apiOk({ active: false, reason: "invalid_or_expired" });
    }

    const tokenId = String(payload.jti ?? "");
    const blocked = tokenId ? await db.tokenBlocklist.findUnique({ where: { id: tokenId } }) : null;
    if (blocked) return apiOk({ active: false, reason: "revoked", tokenId });

    const agent = payload.sub
      ? await db.agent.findUnique({ where: { id: String(payload.sub) } })
      : null;
    if (!agent) return apiOk({ active: false, reason: "unknown_agent", tokenId });
    if (agent.status !== "active") return apiOk({ active: false, reason: `agent_${agent.status}`, tokenId });

    const delegation = await verifyDelegationClaims(payload, String(payload.env ?? ""));
    if (!delegation.ok) {
      return apiOk({
        active: false,
        reason: delegation.code === "delegation_inactive" ? "delegation_inactive" : "revoked",
        tokenId,
      });
    }

    return apiOk({
      active: true,
      tokenId,
      agent: { id: agent.id, name: agent.name, status: agent.status },
      claims: {
        sub: payload.sub,
        env: payload.env,
        project: payload.project,
        org: payload.org,
        scopes: payload.scopes,
        scope_enforced: payload.scope_enforced === true,
        actor: payload.actor,
        client_id: payload.client_id ?? null,
        parent_jti: payload.parent_jti ?? null,
        parent_chain: delegation.parentChain,
        delegation_id: delegation.delegationId,
        cnf: payload.cnf ?? null,
        iss: payload.iss,
        aud: payload.aud,
        iat: payload.iat,
        exp: payload.exp,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
