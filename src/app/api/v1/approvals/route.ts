import { db } from "@/lib/db";
import { apiOk, authenticateApiKey, handleApiError } from "@/lib/api";
import { serializeApproval } from "@/lib/serializers";
import { expireStaleApprovals } from "@/lib/approvals";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    await expireStaleApprovals(auth.environment.id);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const agentId = url.searchParams.get("agent");
    const risk = url.searchParams.get("risk");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    const approvals = await db.approvalRequest.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(status ? { status } : {}),
        ...(agentId ? { agentId } : {}),
        ...(risk ? { risk } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, status: true } },
        credential: { select: { id: true, name: true, connectorSlug: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: limit,
    });

    return apiOk({
      object: "list",
      data: approvals.map((approval) =>
        serializeApproval(approval, {
          agent: approval.agent,
          credential: approval.credential,
        }),
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
