import type { ApprovalPolicy } from "@prisma/client";
import { ApiError } from "../api";
import { auditEvent } from "../audit";
import { recordPolicyEvent } from "../policy-events";
import { storeOf, type ServiceActor, type ServiceStore } from "./types";

export const POLICY_MODES = ["allow", "require_approval", "deny"] as const;
export const POLICY_ROLES = ["owner", "admin", "developer", "approver", "viewer"] as const;

export function normalizeSla(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new ApiError(422, "invalid_sla", "slaMinutes must be an integer between 1 and 10080 (7 days).");
  }
  return minutes;
}

export function normalizeEscalationRole(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const role = String(value);
  if (!(POLICY_ROLES as readonly string[]).includes(role)) {
    throw new ApiError(422, "invalid_escalation_role", `escalateToRole must be one of ${POLICY_ROLES.join(", ")}.`);
  }
  return role;
}

export type CreateApprovalPolicyInput = {
  agentId?: string | null;
  actionPattern: string;
  mode: string;
  slaMinutes?: number | null;
  escalateToRole?: string | null;
};

export async function createApprovalPolicyService(
  actor: ServiceActor,
  input: CreateApprovalPolicyInput,
  store?: ServiceStore,
): Promise<{ policy: ApprovalPolicy; requestId: string }> {
  const client = storeOf(store);
  const actionPattern = String(input.actionPattern || "").trim();
  if (!actionPattern) {
    throw new ApiError(422, "pattern_required", "Provide an action pattern such as “stripe.*” or “gmail.send_message”.");
  }
  if (!input.mode || !(POLICY_MODES as readonly string[]).includes(input.mode)) {
    throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
  }
  if (input.agentId) {
    const agent = await client.agent.findFirst({ where: { id: input.agentId, environmentId: actor.environmentId } });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
  }

  const policy = await client.approvalPolicy.create({
    data: {
      environmentId: actor.environmentId,
      agentId: input.agentId || null,
      actionPattern,
      mode: input.mode,
      slaMinutes: normalizeSla(input.slaMinutes),
      escalateToRole: normalizeEscalationRole(input.escalateToRole),
    },
  });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: input.agentId || "",
      subject: "approval_policy",
      approvalPolicyId: policy.id,
      actions: actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: policy.mode,
      changeKind: "create",
    },
    store,
  );

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: input.agentId || null,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: {
        actionPattern,
        mode: policy.mode,
        scope: input.agentId ? "agent" : "environment",
        slaMinutes: policy.slaMinutes,
        escalateToRole: policy.escalateToRole,
      },
    },
    store,
  );

  return { policy, requestId };
}

export type UpdateApprovalPolicyInput = {
  actionPattern?: string;
  mode?: string;
  slaMinutes?: number | null;
  escalateToRole?: string | null;
};

export async function updateApprovalPolicyService(
  actor: ServiceActor,
  policy: ApprovalPolicy,
  input: UpdateApprovalPolicyInput,
  store?: ServiceStore,
): Promise<{ policy: ApprovalPolicy; requestId: string; changed: string[] }> {
  const client = storeOf(store);
  if (input.mode && !(POLICY_MODES as readonly string[]).includes(input.mode)) {
    throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
  }
  if (
    !input.mode &&
    !input.actionPattern &&
    input.slaMinutes === undefined &&
    input.escalateToRole === undefined
  ) {
    throw new ApiError(422, "no_changes", "Provide an action pattern, mode, SLA or escalation role.");
  }

  const data = {
    ...(input.actionPattern ? { actionPattern: input.actionPattern.trim() } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.slaMinutes !== undefined ? { slaMinutes: normalizeSla(input.slaMinutes) } : {}),
    ...(input.escalateToRole !== undefined
      ? { escalateToRole: normalizeEscalationRole(input.escalateToRole) }
      : {}),
  };

  const updated = await client.approvalPolicy.update({ where: { id: policy.id }, data });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: updated.agentId ?? "",
      subject: "approval_policy",
      approvalPolicyId: updated.id,
      actions: updated.actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: updated.mode,
      changeKind: "update",
    },
    store,
  );

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: policy.agentId,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
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
    },
    store,
  );

  return { policy: updated, requestId, changed: Object.keys(data) };
}

export async function deleteApprovalPolicyService(
  actor: ServiceActor,
  policy: ApprovalPolicy,
  store?: ServiceStore,
): Promise<{ requestId: string }> {
  const client = storeOf(store);
  await client.approvalPolicy.delete({ where: { id: policy.id } });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: policy.agentId ?? "",
      subject: "approval_policy",
      approvalPolicyId: policy.id,
      actions: policy.actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: policy.mode,
      changeKind: "delete",
    },
    store,
  );

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: policy.agentId,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { deleted: { pattern: policy.actionPattern, mode: policy.mode } },
    },
    store,
  );

  return { requestId };
}
