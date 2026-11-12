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
import { auditEvent } from "@/lib/audit";
import { recordPolicyEvent } from "@/lib/policy-events";
import { serializePolicy } from "@/lib/serializers";

const MODES = ["allow", "require_approval", "deny"];
const ROLES = ["owner", "admin", "developer", "approver", "viewer"];

function normalizeSla(value: unknown) {
  if (value === null) return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new ApiError(422, "invalid_sla", "slaMinutes must be an integer between 1 and 10080 (7 days).");
  }
  return minutes;
}

function normalizeEscalationRole(value: unknown) {
  if (value === null || value === "") return null;
  const role = String(value);
  if (!ROLES.includes(role)) {
    throw new ApiError(422, "invalid_escalation_role", `escalateToRole must be one of ${ROLES.join(", ")}.`);
  }
  return role;
}

async function loadPolicy(id: string, environmentId: string) {
  const policy = await db.approvalPolicy.findFirst({ where: { id, environmentId } });
  if (!policy) throw new ApiError(404, "policy_not_found", "No approval policy with that ID exists.");
  return policy;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    return apiOk(serializePolicy(await loadPolicy(id, auth.environment.id)));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const policy = await loadPolicy(id, auth.environment.id);
    const body = await parseJson<{
      actionPattern?: string;
      mode?: string;
      slaMinutes?: number | null;
      escalateToRole?: string | null;
    }>(req);

    if (body.mode && !MODES.includes(body.mode)) {
      throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
    }
    if (
      !body.mode &&
      !body.actionPattern &&
      body.slaMinutes === undefined &&
      body.escalateToRole === undefined
    ) {
      throw new ApiError(422, "no_changes", "Provide an action pattern, mode, SLA or escalation role.");
    }

    const updated = await db.approvalPolicy.update({
      where: { id: policy.id },
      data: {
        ...(body.actionPattern ? { actionPattern: body.actionPattern.trim() } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.slaMinutes !== undefined ? { slaMinutes: normalizeSla(body.slaMinutes) } : {}),
        ...(body.escalateToRole !== undefined
          ? { escalateToRole: normalizeEscalationRole(body.escalateToRole) }
          : {}),
      },
    });

    await recordPolicyEvent({
      environmentId: auth.environment.id,
      organizationId: auth.organization.id,
      agentId: updated.agentId ?? "",
      subject: "approval_policy",
      approvalPolicyId: updated.id,
      actions: updated.actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: updated.mode,
      changeKind: "update",
    });

    const rid = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: policy.agentId,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: {
        before: {
          pattern: policy.actionPattern,
          mode: policy.mode,
          slaMinutes: policy.slaMinutes,
          escalateToRole: policy.escalateToRole,
        },
        after: {
          pattern: updated.actionPattern,
          mode: updated.mode,
          slaMinutes: updated.slaMinutes,
          escalateToRole: updated.escalateToRole,
        },
      },
    });

    return apiOk(serializePolicy(updated), { requestId: rid });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const policy = await loadPolicy(id, auth.environment.id);
    await db.approvalPolicy.delete({ where: { id: policy.id } });

    await recordPolicyEvent({
      environmentId: auth.environment.id,
      organizationId: auth.organization.id,
      agentId: policy.agentId ?? "",
      subject: "approval_policy",
      approvalPolicyId: policy.id,
      actions: policy.actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: policy.mode,
      changeKind: "delete",
    });

    const rid = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: policy.agentId,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: { deleted: { pattern: policy.actionPattern, mode: policy.mode } },
    });

    return apiOk({ id: policy.id, object: "approval_policy", deleted: true }, { requestId: rid });
  } catch (error) {
    return handleApiError(error);
  }
}
