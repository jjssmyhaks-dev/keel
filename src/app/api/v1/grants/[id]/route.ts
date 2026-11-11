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
import { validateActions } from "@/lib/grants";
import { auditEvent } from "@/lib/audit";
import { serializeGrant } from "@/lib/serializers";

async function loadGrant(id: string, environmentId: string) {
  const grant = await db.grant.findFirst({
    where: { id, environmentId },
    include: {
      agent: { select: { id: true, name: true, status: true } },
      credential: { select: { id: true, name: true, connectorSlug: true, status: true } },
    },
  });
  if (!grant) throw new ApiError(404, "grant_not_found", "No grant with that ID exists in this environment.");
  return grant;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const grant = await loadGrant(id, auth.environment.id);
    return apiOk(
      serializeGrant(grant, {
        agent: grant.agent,
        credential: grant.credential,
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
    const grant = await loadGrant(id, auth.environment.id);
    const body = await parseJson<{
      actions?: string[];
      resourcePattern?: string;
      conditions?: Record<string, unknown>;
      approvalMode?: string | null;
      purpose?: string | null;
      expiresAt?: string | null;
      justInTime?: boolean;
      activate?: boolean;
    }>(req);

    const data: Record<string, unknown> = {};
    if (body.actions) {
      const actions = body.actions.map((action) => String(action).trim()).filter(Boolean);
      const validation = await validateActions(grant.credential.connectorSlug, actions, auth.environment.id);
      if (!validation.ok) throw new ApiError(422, "invalid_actions", validation.error);
      data.actionsJson = JSON.stringify(actions);
    }
    if (body.resourcePattern !== undefined) data.resourcePattern = body.resourcePattern.trim() || "*";
    if (body.conditions !== undefined) data.conditionsJson = JSON.stringify(body.conditions);
    if (body.purpose !== undefined) data.purpose = body.purpose?.trim() || null;
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.approvalMode !== undefined) {
      if (body.approvalMode && !["allow", "require_approval", "deny"].includes(body.approvalMode)) {
        throw new ApiError(422, "invalid_approval_mode", "approvalMode must be allow, require_approval or deny.");
      }
      data.approvalMode = body.approvalMode;
    }
    let activated = false;
    if (body.justInTime !== undefined) {
      data.justInTime = body.justInTime;
      if (body.justInTime) {
        data.activatedAt = null;
      } else if (!grant.activatedAt) {
        data.activatedAt = new Date();
      }
    }
    if (body.activate === true) {
      data.justInTime = true;
      data.activatedAt = new Date();
      if (body.expiresAt === undefined && !grant.expiresAt) {
        data.expiresAt = new Date(Date.now() + 60 * 60_000);
      }
      activated = true;
    }

    if (!Object.keys(data).length) {
      throw new ApiError(422, "no_changes", "Provide at least one field to update.");
    }

    const before = {
      actions: JSON.parse(grant.actionsJson || "[]"),
      resource: grant.resourcePattern,
      conditions: JSON.parse(grant.conditionsJson || "{}"),
      approvalMode: grant.approvalMode,
    };
    const updated = await db.grant.update({ where: { id: grant.id }, data });

    const rid = requestId();
    await db.permissionChange.create({
      data: {
        environmentId: auth.environment.id,
        agentId: grant.agentId,
        credentialId: grant.credentialId,
        actorId: auth.apiKeyId,
        actorName: "API key",
        change: "Grant updated",
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify({
          actions: JSON.parse(updated.actionsJson || "[]"),
          resource: updated.resourcePattern,
          conditions: JSON.parse(updated.conditionsJson || "{}"),
          approvalMode: updated.approvalMode,
        }),
      },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: grant.agentId,
      action: "grant.updated",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: { agent: grant.agent.name, connector: grant.credential.connectorSlug, changed: Object.keys(data) },
    });

    if (activated) {
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "human",
        actorId: auth.apiKeyId,
        actorName: "API key",
        agentId: grant.agentId,
        action: "grant.activated",
        resourceType: "grant",
        resourceId: updated.id,
        outcome: "recorded",
        requestId: rid,
        ip: clientIp(req),
        payloadSummary: {
          agent: grant.agent.name,
          connector: grant.credential.connectorSlug,
          manual: true,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
        },
      });
    }

    return apiOk(serializeGrant(updated), { requestId: rid });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const grant = await loadGrant(id, auth.environment.id);

    await db.grant.delete({ where: { id: grant.id } });

    const rid = requestId();
    await db.permissionChange.create({
      data: {
        environmentId: auth.environment.id,
        agentId: grant.agentId,
        credentialId: grant.credentialId,
        actorId: auth.apiKeyId,
        actorName: "API key",
        change: "Grant removed",
        beforeJson: JSON.stringify({
          actions: JSON.parse(grant.actionsJson || "[]"),
          resource: grant.resourcePattern,
        }),
        afterJson: "{}",
      },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: grant.agentId,
      action: "grant.deleted",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: { agent: grant.agent.name, connector: grant.credential.connectorSlug },
    });

    return apiOk({ id: grant.id, object: "grant", deleted: true }, { requestId: rid });
  } catch (error) {
    return handleApiError(error);
  }
}
