import { db } from "@/lib/db";
import { apiOk, handleApiError, authenticateApiKey, requireSecretKey, parseJson, clientIp, ApiError } from "@/lib/api";
import { serializeAgent } from "@/lib/serializers";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({
      where: { id, environmentId: auth.environment.id },
      include: {
        keys: { select: { id: true, status: true, createdAt: true, rotatedAt: true, retireAt: true } },
        grants: { include: { credential: true } },
        approvalPolicies: true,
      },
    });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");

    return apiOk(
      serializeAgent(agent, {
        keys: agent.keys,
        grants: agent.grants.map((g) => ({
          id: g.id,
          credentialId: g.credentialId,
          connector: g.credential.connectorSlug,
          actions: JSON.parse(g.actionsJson || "[]"),
          resourcePattern: g.resourcePattern,
          approvalMode: g.approvalMode,
          expiresAt: g.expiresAt?.toISOString() ?? null,
        })),
        approvalPolicies: agent.approvalPolicies.map((p) => ({
          id: p.id,
          actionPattern: p.actionPattern,
          mode: p.mode,
        })),
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({ where: { id, environmentId: auth.environment.id } });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");

    const body = await parseJson<{
      name?: string;
      description?: string | null;
      tags?: string[];
      framework?: string | null;
      autonomousMode?: boolean;
    }>(req);

    const updated = await db.agent.update({
      where: { id: agent.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim().slice(0, 60) } : {}),
        ...(body.description !== undefined ? { description: body.description?.slice(0, 280) || null } : {}),
        ...(body.tags !== undefined ? { tagsJson: JSON.stringify(body.tags.slice(0, 12)) } : {}),
        ...(body.framework !== undefined ? { framework: body.framework?.slice(0, 60) || null } : {}),
        ...(body.autonomousMode !== undefined ? { autonomousMode: Boolean(body.autonomousMode) } : {}),
      },
    });

    return apiOk(serializeAgent(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({ where: { id, environmentId: auth.environment.id } });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");

    const updated = await db.agent.update({
      where: { id: agent.id },
      data: { status: "revoked" },
    });
    await db.grant.deleteMany({ where: { agentId: agent.id } });
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: agent.id,
      action: "agent.revoked",
      resourceType: "agent",
      resourceId: agent.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { name: agent.name, via: "api" },
    });
    await dispatchEvent(auth.environment.id, "agent.status_changed", {
      agentId: agent.id,
      name: agent.name,
      status: "revoked",
    });

    return apiOk({ ...serializeAgent(updated), revoked: true });
  } catch (error) {
    return handleApiError(error);
  }
}
