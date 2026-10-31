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
import { decideApproval } from "@/lib/approvals";
import { serializeApproval } from "@/lib/serializers";

async function loadApproval(id: string, environmentId: string) {
  const approval = await db.approvalRequest.findFirst({
    where: { id, environmentId },
    include: {
      agent: { select: { id: true, name: true, status: true } },
      credential: { select: { id: true, name: true, connectorSlug: true } },
    },
  });
  if (!approval) throw new ApiError(404, "approval_not_found", "No approval with that ID exists in this environment.");
  return approval;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const approval = await loadApproval(id, auth.environment.id);
    return apiOk(
      serializeApproval(approval, {
        agent: approval.agent,
        credential: approval.credential,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    await loadApproval(id, auth.environment.id);
    const body = await parseJson<{ decision?: string; note?: string; approveAlways?: boolean }>(req);
    if (body.decision !== "approve" && body.decision !== "deny") {
      throw new ApiError(422, "invalid_decision", "decision must be “approve” or “deny”.");
    }

    const outcome = await decideApproval({
      approvalId: id,
      decision: body.decision,
      note: body.note,
      userId: auth.apiKeyId,
      userName: "API key",
      approveAlways: Boolean(body.approveAlways),
      ip: clientIp(req),
    });
    if (!outcome.ok) throw new ApiError(409, "approval_closed", outcome.error);

    const approval = await loadApproval(id, auth.environment.id);
    return apiOk(
      serializeApproval(approval, {
        agent: approval.agent,
        credential: approval.credential,
        execution: outcome.result ?? null,
      }),
      { requestId: requestId() },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
