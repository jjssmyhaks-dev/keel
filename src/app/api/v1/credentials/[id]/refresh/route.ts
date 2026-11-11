import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  requestId,
  requireSecretKey,
} from "@/lib/api";
import { auditEvent } from "@/lib/audit";
import { refreshCredentialToken } from "@/lib/oauth-connect";
import { serializeCredential } from "@/lib/serializers";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const credential = await db.credential.findFirst({
      where: { id, environmentId: auth.environment.id },
    });
    if (!credential) {
      throw new ApiError(404, "credential_not_found", "No connection with that ID exists in this environment.");
    }
    if (credential.type !== "oauth") {
      throw new ApiError(409, "not_refreshable", "Only OAuth connections carry refresh tokens.");
    }
    if (!credential.refreshable) {
      throw new ApiError(409, "no_refresh_token", "This connection has no refresh token. Reconnect it with OAuth.");
    }

    let updated;
    try {
      updated = await refreshCredentialToken(credential.id);
    } catch (error) {
      throw new ApiError(
        502,
        "refresh_failed",
        error instanceof Error ? error.message : "The provider rejected the refresh request.",
      );
    }

    const request = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "credential.refreshed",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      requestId: request,
      ip: clientIp(req),
      payloadSummary: {
        connector: credential.connectorSlug,
        expiresAt: updated.tokenExpiresAt?.toISOString() ?? null,
      },
    });

    return apiOk(serializeCredential(updated), { requestId: request });
  } catch (error) {
    return handleApiError(error);
  }
}
