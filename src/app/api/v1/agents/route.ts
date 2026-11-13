import { db } from "@/lib/db";
import {
  apiOk,
  apiError,
  handleApiError,
  authenticateApiKey,
  requireSecretKey,
  parseJson,
  ApiError,
} from "@/lib/api";
import { dispatchEvent } from "@/lib/webhooks";
import { registerAgentService } from "@/lib/services/agents";
import { serializeAgent } from "@/lib/serializers";
import { checkPlanLimit, productionAccess } from "@/lib/limits";
import { isAgentType } from "@/lib/agent-types";
import { issueIdentityDocumentSafe } from "@/lib/identity-document";

export async function GET(req: Request) {
  try {
    const ctx = await authenticateApiKey(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const tag = url.searchParams.get("tag");
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    const agents = await db.agent.findMany({
      where: {
        environmentId: ctx.environment.id,
        ...(status ? { status } : {}),
        ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const filtered = tag ? agents.filter((a) => (JSON.parse(a.tagsJson || "[]") as string[]).includes(tag)) : agents;
    return apiOk({ object: "list", data: filtered.map((a) => serializeAgent(a)) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await authenticateApiKey(req);
    requireSecretKey(ctx);
    const body = await parseJson<{
      name?: string;
      description?: string;
      tags?: string[];
      owner?: string;
      framework?: string;
      publicKey?: string;
      keyMode?: "client" | "platform";
      type?: string;
    }>(req);

    if (body.type !== undefined && !isAgentType(body.type)) {
      throw new ApiError(422, "invalid_agent_type", "Type must be one of support, sales, finance, coding, research, operations, data or other.");
    }
    const name = String(body.name || "").trim();
    if (!name || name.length > 60) {
      throw new ApiError(422, "invalid_name", "Agent name is required and must be 60 characters or fewer.");
    }
    if (name.length < 2) throw new ApiError(422, "invalid_name", "Agent name must be at least 2 characters.");
    if (ctx.environment.type === "production") {
      const access = productionAccess(ctx.organization.plan, ctx.organization.planStatus);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }
    const quota = await checkPlanLimit(ctx.organization.id, "agents", ctx.organization.plan, ctx.organization.planStatus);
    if (!quota.allowed) {
      throw new ApiError(402, "plan_limit_reached", quota.message, {
        used: quota.used,
        limit: quota.limit,
        plan: quota.plan,
      });
    }

    const existing = await db.agent.findFirst({
      where: { environmentId: ctx.environment.id, name },
    });
    if (existing) {
      throw new ApiError(409, "agent_name_taken", `An agent named “${name}” already exists in this environment.`);
    }

    let ownerUserId: string | null = null;
    if (body.owner) {
      const owner = await db.user.findUnique({ where: { email: body.owner.toLowerCase() } });
      const membership = owner
        ? await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.organization.id, userId: owner.id } } })
        : null;
      if (!membership) throw new ApiError(422, "invalid_owner", "Owner must be a member of this organization.");
      ownerUserId = owner!.id;
    }

    const { agent, privateKey, fingerprint, requestId } = await registerAgentService(
      {
        environmentId: ctx.environment.id,
        organizationId: ctx.organization.id,
        actorId: ctx.apiKeyId,
        actorName: "API key",
        projectId: ctx.project.id,
      },
      {
        name,
        description: body.description,
        tags: body.tags,
        type: body.type,
        framework: body.framework,
        ownerUserId,
        publicKey: body.publicKey,
        keyMode: body.keyMode,
      },
    );

    await dispatchEvent(ctx.environment.id, "agent.registered", {
      agentId: agent.id,
      name,
      fingerprint,
      environment: ctx.environment.type,
    });
    await issueIdentityDocumentSafe(agent.id);

    return apiOk(
      {
        ...serializeAgent(agent),
        privateKey,
        warning: privateKey ? "Store this private key securely. It will not be shown again." : undefined,
      },
      { status: 201, requestId },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export function OPTIONS() {
  return apiError(405, "method_not_allowed", "Use GET or POST.");
}
