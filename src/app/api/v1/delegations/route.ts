import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requestId,
  requireSecretKey,
} from "@/lib/api";
import { agentGrantScopes } from "@/lib/agent-secrets";
import { scopeListFromJson, restrictionsFromJson } from "@/lib/delegations";
import { auditEvent } from "@/lib/audit";
import { recordPolicyEvent } from "@/lib/policy-events";

type DelegationRow = {
  id: string;
  parentAgentId: string;
  childAgentId: string;
  scopesJson: string;
  restrictionsJson: string;
  purpose: string | null;
  depth: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  parent?: { id: string; name: string; status: string };
  child?: { id: string; name: string; status: string };
};

function serializeDelegation(row: DelegationRow) {
  return {
    object: "delegation",
    id: row.id,
    parentAgentId: row.parentAgentId,
    childAgentId: row.childAgentId,
    parent: row.parent ?? null,
    child: row.child ?? null,
    scopes: scopeListFromJson(row.scopesJson),
    restrictions: restrictionsFromJson(row.restrictionsJson),
    purpose: row.purpose,
    depth: row.depth,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const agentId = url.searchParams.get("agent");
    const rows = await db.delegation.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(agentId ? { OR: [{ parentAgentId: agentId }, { childAgentId: agentId }] } : {}),
      },
      include: {
        parent: { select: { id: true, name: true, status: true } },
        child: { select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return apiOk({ object: "list", data: rows.map(serializeDelegation) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      parentAgentId?: string;
      childAgentId?: string;
      scopes?: string[];
      purpose?: string;
      expiresAt?: string | null;
      restrictions?: { maxTtlSeconds?: number; resourceSubset?: string; maxCalls?: number };
    }>(req);

    const parentAgentId = body.parentAgentId?.trim();
    const childAgentId = body.childAgentId?.trim();
    if (!parentAgentId || !childAgentId) {
      throw new ApiError(422, "missing_agent", "Provide both parentAgentId and childAgentId.");
    }
    if (parentAgentId === childAgentId) {
      throw new ApiError(422, "invalid_delegation", "An agent cannot delegate to itself.");
    }

    const [parent, child] = await Promise.all([
      db.agent.findFirst({ where: { id: parentAgentId, environmentId: auth.environment.id } }),
      db.agent.findFirst({ where: { id: childAgentId, environmentId: auth.environment.id } }),
    ]);
    if (!parent) throw new ApiError(404, "parent_not_found", "No parent agent with that ID exists in this environment.");
    if (!child) throw new ApiError(404, "child_not_found", "No child agent with that ID exists in this environment.");
    if (parent.status !== "active" || child.status !== "active") {
      throw new ApiError(409, "agent_inactive", "Both agents must be active before you can record a delegation.");
    }

    const scopes = [...new Set((body.scopes ?? []).map((scope) => String(scope).trim()).filter(Boolean))];
    if (!scopes.length) {
      throw new ApiError(422, "scopes_required", "List at least one scope the child may use on the parent's behalf.");
    }
    const parentScopes = new Set(await agentGrantScopes(parent.id));
    const exceeding = scopes.filter((scope) => !parentScopes.has(scope));
    if (exceeding.length) {
      throw new ApiError(
        422,
        "invalid_scopes",
        `The parent agent has no grant for: ${exceeding.join(", ")}. A delegation can only narrow its access.`,
      );
    }

    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new ApiError(422, "invalid_expiry", "expiresAt must be a future date.");
      }
    }

    const restrictions: Record<string, number | string> = {};
    const rawRestrictions = body.restrictions ?? {};
    if (rawRestrictions.maxTtlSeconds !== undefined) {
      const value = Number(rawRestrictions.maxTtlSeconds);
      if (!Number.isFinite(value) || value < 60 || value > 3600) {
        throw new ApiError(422, "invalid_restrictions", "restrictions.maxTtlSeconds must be between 60 and 3600.");
      }
      restrictions.maxTtlSeconds = Math.floor(value);
    }
    if (rawRestrictions.resourceSubset) {
      restrictions.resourceSubset = String(rawRestrictions.resourceSubset).slice(0, 120);
    }
    if (rawRestrictions.maxCalls !== undefined) {
      const value = Number(rawRestrictions.maxCalls);
      if (!Number.isFinite(value) || value < 1) {
        throw new ApiError(422, "invalid_restrictions", "restrictions.maxCalls must be a positive integer.");
      }
      restrictions.maxCalls = Math.floor(value);
    }

    const existing = await db.delegation.findFirst({
      where: {
        environmentId: auth.environment.id,
        parentAgentId: parent.id,
        childAgentId: child.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (existing) {
      throw new ApiError(
        409,
        "delegation_exists",
        "An active delegation already links these agents. Revoke it before recording a new one.",
      );
    }

    const id = requestId();
    const delegation = await db.delegation.create({
      data: {
        environmentId: auth.environment.id,
        parentAgentId: parent.id,
        childAgentId: child.id,
        scopesJson: JSON.stringify(scopes),
        restrictionsJson: JSON.stringify(restrictions),
        depth: 1,
        purpose: body.purpose?.trim().slice(0, 280) || null,
        expiresAt,
      },
      include: {
        parent: { select: { id: true, name: true, status: true } },
        child: { select: { id: true, name: true, status: true } },
      },
    });

    await db.permissionChange.create({
      data: {
        environmentId: auth.environment.id,
        agentId: child.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        change: "Delegation created",
        beforeJson: "{}",
        afterJson: JSON.stringify({ parent: parent.id, scopes, restrictions, expiresAt: expiresAt?.toISOString() ?? null }),
      },
    });

    await recordPolicyEvent({
      environmentId: auth.environment.id,
      organizationId: auth.organization.id,
      agentId: child.id,
      agentType: child.agentType,
      subject: "delegation",
      actions: scopes,
      resourcePattern: typeof restrictions.resourceSubset === "string" ? restrictions.resourceSubset : "*",
      changeKind: "create",
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: child.id,
      action: "delegation.created",
      resourceType: "delegation",
      resourceId: delegation.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: { parent: parent.name, child: child.name, scopes, restrictions },
    });

    return apiOk(serializeDelegation(delegation), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
