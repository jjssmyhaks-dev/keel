import { db } from "@/lib/db";
import {
  apiOk,
  apiError,
  handleApiError,
  authenticateApiKey,
  requireSecretKey,
  parseJson,
  clientIp,
  requestId,
  ApiError,
} from "@/lib/api";
import {
  encryptSecret,
  generateAgentIdentity,
  fingerprintFor,
} from "@/lib/crypto";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { serializeAgent } from "@/lib/serializers";
import { checkPlanLimit, productionAccess } from "@/lib/limits";

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
    }>(req);

    const name = String(body.name || "").trim();
    if (!name || name.length > 60) {
      throw new ApiError(422, "invalid_name", "Agent name is required and must be 60 characters or fewer.");
    }
    if (name.length < 2) throw new ApiError(422, "invalid_name", "Agent name must be at least 2 characters.");
    if (ctx.environment.type === "production") {
      const access = productionAccess(ctx.organization.plan);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }
    const quota = await checkPlanLimit(ctx.organization.id, "agents", ctx.organization.plan);
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

    let publicKey = body.publicKey?.trim() || null;
    let privateKey: string | null = null;
    let fingerprint: string;
    let encryptedPrivateKey: string | null = null;

    if (publicKey) {
      fingerprint = fingerprintFor(publicKey);
    } else {
      const identity = generateAgentIdentity();
      publicKey = identity.publicKey;
      privateKey = identity.privateKey;
      fingerprint = identity.fingerprint;
      if ((body.keyMode ?? "client") === "platform") {
        const sealed = await encryptSecret(ctx.project.id, { privateKey: identity.privateKey });
        encryptedPrivateKey = JSON.stringify(sealed);
      }
    }

    const agent = await db.agent.create({
      data: {
        environmentId: ctx.environment.id,
        name,
        description: body.description?.trim() || null,
        ownerUserId,
        publicKey,
        fingerprint,
        keyMode: body.keyMode === "platform" ? "platform" : "client",
        tagsJson: JSON.stringify((body.tags ?? []).filter((t) => typeof t === "string").slice(0, 12)),
        framework: body.framework?.trim() || null,
        keys: {
          create: {
            publicKey: publicKey!,
            encryptedPrivateKey,
          },
        },
      },
    });

    const id = requestId();
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: ctx.apiKeyId,
      actorName: "API key",
      action: "agent.registered",
      resourceType: "agent",
      resourceId: agent.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: { name, keyMode: agent.keyMode, fingerprint, owner: body.owner ?? null },
    });
    await dispatchEvent(ctx.environment.id, "agent.registered", {
      agentId: agent.id,
      name,
      fingerprint,
      environment: ctx.environment.type,
    });

    return apiOk(
      {
        ...serializeAgent(agent),
        privateKey,
        warning: privateKey ? "Store this private key securely. It will not be shown again." : undefined,
      },
      { status: 201, requestId: id },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export function OPTIONS() {
  return apiError(405, "method_not_allowed", "Use GET or POST.");
}
