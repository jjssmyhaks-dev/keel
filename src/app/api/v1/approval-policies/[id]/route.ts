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
    const body = await parseJson<{ actionPattern?: string; mode?: string }>(req);

    if (body.mode && !MODES.includes(body.mode)) {
      throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
    }
    if (!body.mode && !body.actionPattern) {
      throw new ApiError(422, "no_changes", "Provide an action pattern or a mode.");
    }

    const updated = await db.approvalPolicy.update({
      where: { id: policy.id },
      data: {
        ...(body.actionPattern ? { actionPattern: body.actionPattern.trim() } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
      },
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
      payloadSummary: { before: { pattern: policy.actionPattern, mode: policy.mode }, after: { pattern: updated.actionPattern, mode: updated.mode } },
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
