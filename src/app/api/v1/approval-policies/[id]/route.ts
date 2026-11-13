import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import {
  deleteApprovalPolicyService,
  updateApprovalPolicyService,
} from "@/lib/services/approval-policies";
import { serializePolicy } from "@/lib/serializers";

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

    const result = await updateApprovalPolicyService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      policy,
      {
        actionPattern: body.actionPattern,
        mode: body.mode,
        slaMinutes: body.slaMinutes,
        escalateToRole: body.escalateToRole,
      },
    );

    return apiOk(serializePolicy(result.policy), { requestId: result.requestId });
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

    const result = await deleteApprovalPolicyService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      policy,
    );

    return apiOk({ id: policy.id, object: "approval_policy", deleted: true }, { requestId: result.requestId });
  } catch (error) {
    return handleApiError(error);
  }
}
