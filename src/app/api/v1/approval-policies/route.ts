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
import { serializePolicy } from "@/lib/serializers";

const MODES = ["allow", "require_approval", "deny"];

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
    const body = await parseJson<{ agentId?: string | null; actionPattern?: string; mode?: string }>(req);

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
      },
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
      payloadSummary: { actionPattern, mode: policy.mode, scope: body.agentId ? "agent" : "environment" },
    });

    return apiOk(serializePolicy(policy), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
