import { db } from "@/lib/db";
import {
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

async function agentNames(environmentId: string) {
  const agents = await db.agent.findMany({ where: { environmentId }, select: { id: true, name: true } });
  return new Map(agents.map((agent) => [agent.id, agent.name]));
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const identities = await db.workloadIdentity.findMany({
      where: { environmentId: auth.environment.id },
      orderBy: { createdAt: "desc" },
    });
    const names = await agentNames(auth.environment.id);
    return apiOk({
      object: "list",
      data: identities.map((identity) => ({
        ...serializeWorkloadIdentity(identity),
        agentName: identity.agentId ? names.get(identity.agentId) ?? null : null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<WorkloadIdentityInput>(req);
    const data = await validateWorkloadIdentityInput(body, auth.environment.id);

    const identity = await db.workloadIdentity.create({
      data: {
        environmentId: auth.environment.id,
        name: String(data.name),
        type: String(data.type ?? "spiffe"),
        issuer: String(data.issuer),
        audience: String(data.audience),
        agentId: String(data.agentId),
        jwksUrl: (data.jwksUrl as string | null) ?? null,
        jwksJson: (data.jwksJson as string | null) ?? null,
        subjectPattern: (data.subjectPattern as string | null) ?? null,
        requiredClaimsJson: String(data.requiredClaimsJson ?? "{}"),
        tokenTtlSeconds: Number(data.tokenTtlSeconds ?? 300),
        enabled: data.enabled === undefined ? true : Boolean(data.enabled),
      },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: identity.agentId,
      action: "workload_identity.created",
      resourceType: "workload_identity",
      resourceId: identity.id,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: {
        name: identity.name,
        type: identity.type,
        issuer: identity.issuer,
        audience: identity.audience,
        subjectPattern: identity.subjectPattern,
      },
    });

    return apiOk(serializeWorkloadIdentity(identity), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
