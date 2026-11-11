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
import { checkCredentialHealth } from "@/lib/credential-health";
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

    const result = await checkCredentialHealth(credential.id);
    const updated = await db.credential.findUniqueOrThrow({ where: { id: credential.id } });

    const request = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "credential.checked",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: result.outcome === "ok" ? "allowed" : result.outcome === "skipped" ? "recorded" : "error",
      requestId: request,
      ip: clientIp(req),
      payloadSummary: {
        connector: credential.connectorSlug,
        result: result.outcome,
        status: result.status,
      },
    });

    return apiOk(
      {
        ...serializeCredential(updated),
        check: {
          outcome: result.outcome,
          detail: result.detail,
          status: result.status ?? null,
        },
      },
      { requestId: request },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
