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
import { verifyAgentToken } from "@/lib/jwt";
import { auditEvent } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{ token?: string; tokenId?: string; agentId?: string; expiresAt?: string }>(req);

    let tokenId = body.tokenId?.trim() || "";
    let agentId = body.agentId?.trim() || "";
    let expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 3600_000);

    if (body.token) {
      let payload: Record<string, unknown>;
      try {
        payload = (await verifyAgentToken(body.token)) as Record<string, unknown>;
      } catch {
        throw new ApiError(422, "invalid_token", "This agent token is invalid or has already expired.");
      }
      tokenId = String(payload.jti ?? "");
      agentId = String(payload.sub ?? "");
      if (typeof payload.exp === "number") expiresAt = new Date(payload.exp * 1000);
      if (payload.env && String(payload.env) !== auth.environment.id) {
        throw new ApiError(403, "environment_mismatch", "This token belongs to a different environment.");
      }
    }

    if (!tokenId || !agentId) {
      throw new ApiError(422, "missing_token", "Provide the raw token or both tokenId and agentId.");
    }

    const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: auth.environment.id } });
    if (!agent) throw new ApiError(404, "agent_not_found", "The token's agent does not exist in this environment.");

    await db.tokenBlocklist.upsert({
      where: { id: tokenId },
      update: { revokedAt: new Date() },
      create: { id: tokenId, agentId: agent.id, expiresAt },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: agent.id,
      action: "token.revoked",
      resourceType: "token",
      resourceId: tokenId,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { agent: agent.name, expiresAt: expiresAt.toISOString() },
    });

    return apiOk({ object: "token", tokenId, agentId: agent.id, revoked: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const tokenId = url.searchParams.get("tokenId");
    if (tokenId) {
      const blocked = await db.tokenBlocklist.findUnique({ where: { id: tokenId } });
      return apiOk({
        object: "token",
        tokenId,
        revoked: Boolean(blocked),
        revokedAt: blocked?.revokedAt.toISOString() ?? null,
      });
    }
    const agentIds = (
      await db.agent.findMany({ where: { environmentId: auth.environment.id }, select: { id: true } })
    ).map((agent) => agent.id);
    const blocked = await db.tokenBlocklist.findMany({
      where: { agentId: { in: agentIds } },
      orderBy: { revokedAt: "desc" },
      take: 100,
    });
    return apiOk({
      object: "list",
      data: blocked.map((entry) => ({
        tokenId: entry.id,
        agentId: entry.agentId,
        revokedAt: entry.revokedAt.toISOString(),
        expiresAt: entry.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
