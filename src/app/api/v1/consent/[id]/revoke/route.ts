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
import { revokeConsentRecord } from "@/lib/consent";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const existing = await db.consent.findFirst({
      where: { id, projectId: auth.project.id },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "consent_not_found", "No consent with that ID exists.");

    const body = await parseJson<{ reason?: string }>(req).catch(() => ({}) as { reason?: string });
    const revoked = await revokeConsentRecord(
      existing.id,
      { actorType: "human", actorId: auth.apiKeyId, actorName: "API key" },
      {
        reason: body.reason?.trim().slice(0, 200) || "customer_revoked",
        requestId: requestId(),
        ip: clientIp(req),
      },
    );

    return apiOk({
      id: revoked.id,
      agentId: revoked.agentId,
      endUserId: revoked.endUserId,
      revokedAt: revoked.revokedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
