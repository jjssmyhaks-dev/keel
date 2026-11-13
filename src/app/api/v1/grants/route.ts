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
import { createGrantService } from "@/lib/services/grants";
import { serializeGrant } from "@/lib/serializers";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const agentId = url.searchParams.get("agent");
    const credentialId = url.searchParams.get("credential");
    const grants = await db.grant.findMany({
      where: {
        environmentId: auth.environment.id,
        endUserId: null,
        ...(agentId ? { agentId } : {}),
        ...(credentialId ? { credentialId } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, status: true } },
        credential: { select: { id: true, name: true, connectorSlug: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return apiOk({
      object: "list",
      data: grants.map((grant) =>
        serializeGrant(grant, {
          agent: grant.agent,
          credential: grant.credential,
        }),
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      agentId?: string;
      credentialId?: string;
      actions?: string[];
      resourcePattern?: string;
      conditions?: Record<string, unknown>;
      approvalMode?: string | null;
      purpose?: string;
      expiresAt?: string | null;
      justInTime?: boolean;
    }>(req);

    if (!body.agentId || !body.credentialId) {
      throw new ApiError(422, "missing_reference", "Provide both agentId and credentialId.");
    }

    const [agent, credential] = await Promise.all([
      db.agent.findFirst({ where: { id: body.agentId, environmentId: auth.environment.id } }),
      db.credential.findFirst({ where: { id: body.credentialId, environmentId: auth.environment.id, endUserId: null } }),
    ]);
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
    if (!credential) throw new ApiError(404, "credential_not_found", "No connection with that ID exists in this environment.");

    const { grant, requestId: id } = await createGrantService(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
      },
      {
        agent,
        credential,
        actions: body.actions ?? [],
        resourcePattern: body.resourcePattern,
        conditions: body.conditions,
        approvalMode: body.approvalMode,
        purpose: body.purpose,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        justInTime: body.justInTime === true,
      },
    );

    return apiOk(serializeGrant(grant), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
