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
  if (value === undefined || value === null) return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new ApiError(422, "invalid_sla", "slaMinutes must be an integer between 1 and 10080 (7 days).");
  }
  return minutes;
}

function normalizeEscalationRole(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const role = String(value);
  if (!ROLES.includes(role)) {
    throw new ApiError(422, "invalid_escalation_role", `escalateToRole must be one of ${ROLES.join(", ")}.`);
  }
  return role;
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const agentId = url.searchParams.get("agent");
    const policies = await db.approvalPolicy.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(agentId ? { OR: [{ agentId }, { agentId: null }] } : {}),
      },
      orderBy: [{ agentId: "desc" }, { createdAt: "asc" }],
    });
    return apiOk({ object: "list", data: policies.map(serializePolicy) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      agentId?: string | null;
      actionPattern?: string;
      mode?: string;
      slaMinutes?: number | null;
      escalateToRole?: string | null;
    }>(req);

    const actionPattern = String(body.actionPattern || "").trim();
    if (!actionPattern) {
      throw new ApiError(422, "pattern_required", "Provide an action pattern such as “stripe.*” or “gmail.send_message”.");
    }
    if (!body.mode || !MODES.includes(body.mode)) {
      throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
    }
    if (body.agentId) {
      const agent = await db.agent.findFirst({ where: { id: body.agentId, environmentId: auth.environment.id } });
      if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
    }

    const policy = await db.approvalPolicy.create({
      data: {
        environmentId: auth.environment.id,
        agentId: body.agentId || null,
        actionPattern,
        mode: body.mode,
        slaMinutes: normalizeSla(body.slaMinutes),
        escalateToRole: normalizeEscalationRole(body.escalateToRole),
      },
    });

    await recordPolicyEvent({
      environmentId: auth.environment.id,
      organizationId: auth.organization.id,
      agentId: body.agentId || "",
      subject: "approval_policy",
      approvalPolicyId: policy.id,
      actions: actionPattern.split(",").map((value) => value.trim()).filter(Boolean),
      approvalMode: policy.mode,
      changeKind: "create",
    });

    const id = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: body.agentId || null,
      action: "settings.updated",
      resourceType: "approval_policy",
      resourceId: policy.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: {
        actionPattern,
        mode: policy.mode,
        scope: body.agentId ? "agent" : "environment",
        slaMinutes: policy.slaMinutes,
        escalateToRole: policy.escalateToRole,
      },
    });

    return apiOk(serializePolicy(policy), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
