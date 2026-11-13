import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, clientIp, handleApiError, requireSecretKey } from "@/lib/api";
import { randomToken, sha256 } from "@/lib/crypto";
import { CONTROL_LINK_TTL_MS, controlCenterUrl } from "@/lib/consent";
import { auditEvent } from "@/lib/audit";

export async function POST(req: Request, ctx: { params: Promise<{ externalUserId: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { externalUserId } = await ctx.params;
    const endUser = await db.endUser.findFirst({
      where: { projectId: auth.project.id, externalUserId: decodeURIComponent(externalUserId) },
    });
    if (!endUser || endUser.deletedAt) {
      throw new ApiError(404, "end_user_not_found", "No end user with that external id exists in this project.");
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + CONTROL_LINK_TTL_MS);
    await db.endUserLink.create({
      data: {
        endUserId: endUser.id,
        tokenHash: sha256(token),
        purpose: "control_center",
        expiresAt,
      },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "consent.control_link_created",
      resourceType: "end_user",
      resourceId: endUser.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { endUser: { id: endUser.id, externalUserId: endUser.externalUserId }, expiresAt: expiresAt.toISOString() },
    });

    return apiOk({ url: controlCenterUrl(token), expiresAt: expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
