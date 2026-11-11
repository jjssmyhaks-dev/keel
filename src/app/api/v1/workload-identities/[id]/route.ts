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
import { validateWorkloadIdentityInput, type WorkloadIdentityInput } from "@/lib/workload-identities";
import { auditEvent } from "@/lib/audit";
import { serializeWorkloadIdentity } from "@/lib/serializers";

async function loadIdentity(id: string, environmentId: string) {
  const identity = await db.workloadIdentity.findFirst({ where: { id, environmentId } });
  if (!identity) {
    throw new ApiError(404, "workload_identity_not_found", "No workload identity with that ID exists in this environment.");
  }
  return identity;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { id } = await ctx.params;
    const identity = await loadIdentity(id, auth.environment.id);
    return apiOk(serializeWorkloadIdentity(identity));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const identity = await loadIdentity(id, auth.environment.id);
    const body = await parseJson<WorkloadIdentityInput>(req);
    const data = await validateWorkloadIdentityInput(body, auth.environment.id, { partial: true });
    if (!Object.keys(data).length) {
      throw new ApiError(422, "no_changes", "Provide at least one field to update.");
    }

    const updated = await db.workloadIdentity.update({ where: { id: identity.id }, data });
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: updated.agentId,
      action: "workload_identity.updated",
      resourceType: "workload_identity",
      resourceId: updated.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { name: updated.name, fields: Object.keys(data) },
    });
    return apiOk(serializeWorkloadIdentity(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const identity = await loadIdentity(id, auth.environment.id);
    await db.workloadIdentity.delete({ where: { id: identity.id } });
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: identity.agentId,
      action: "workload_identity.deleted",
      resourceType: "workload_identity",
      resourceId: identity.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { name: identity.name, issuer: identity.issuer },
    });
    return apiOk({ object: "workload_identity", id: identity.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
