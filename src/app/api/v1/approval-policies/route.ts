import { db } from "@/lib/db";
import {
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { createApprovalPolicyService } from "@/lib/services/approval-policies";
import { serializePolicy } from "@/lib/serializers";

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

    const { policy, requestId } = await createApprovalPolicyService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      {
        agentId: body.agentId,
        actionPattern: String(body.actionPattern || ""),
        mode: String(body.mode || ""),
        slaMinutes: body.slaMinutes,
        escalateToRole: body.escalateToRole,
      },
    );

    return apiOk(serializePolicy(policy), { status: 201, requestId });
  } catch (error) {
    return handleApiError(error);
  }
}
