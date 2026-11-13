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
import { deleteGrantService, updateGrantService } from "@/lib/services/grants";
import { serializeGrant } from "@/lib/serializers";

async function loadGrant(id: string, environmentId: string) {
  const grant = await db.grant.findFirst({
    where: { id, environmentId },
    include: {
      agent: { select: { id: true, name: true, status: true, agentType: true } },
      credential: { select: { id: true, name: true, connectorSlug: true, status: true, revokedAt: true } },
    },
  });
  if (!grant) throw new ApiError(404, "grant_not_found", "No grant with that ID exists in this environment.");
  return grant;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const grant = await loadGrant(id, auth.environment.id);
    return apiOk(
      serializeGrant(grant, {
        agent: grant.agent,
        credential: grant.credential,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const grant = await loadGrant(id, auth.environment.id);
    const body = await parseJson<{
      actions?: string[];
      resourcePattern?: string;
      conditions?: Record<string, unknown>;
      approvalMode?: string | null;
      purpose?: string | null;
      expiresAt?: string | null;
      justInTime?: boolean;
      activate?: boolean;
    }>(req);

    const result = await updateGrantService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      grant,
      {
        actions: body.actions,
        resourcePattern: body.resourcePattern,
        conditions: body.conditions,
        approvalMode: body.approvalMode,
        purpose: body.purpose,
        expiresAt: body.expiresAt !== undefined ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
        justInTime: body.justInTime,
        activate: body.activate,
      },
    );

    return apiOk(serializeGrant(result.grant), { requestId: result.requestId });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const grant = await loadGrant(id, auth.environment.id);

    const result = await deleteGrantService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      grant,
    );

    return apiOk({ id: grant.id, object: "grant", deleted: true }, { requestId: result.requestId });
  } catch (error) {
    return handleApiError(error);
  }
}
