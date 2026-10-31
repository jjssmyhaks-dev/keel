import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, parseJson } from "@/lib/api";
import { verifyAgentToken } from "@/lib/jwt";

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
        actor: payload.actor,
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
