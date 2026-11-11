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
import { validateActions } from "@/lib/grants";
import { auditEvent } from "@/lib/audit";
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
      db.credential.findFirst({ where: { id: body.credentialId, environmentId: auth.environment.id } }),
    ]);
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
    if (!credential) throw new ApiError(404, "credential_not_found", "No connection with that ID exists in this environment.");
    if (credential.revokedAt || credential.status === "revoked") {
      throw new ApiError(409, "credential_revoked", "This connection was revoked. Rotate it before granting access.");
    }

    const actions = (body.actions ?? []).map((action) => String(action).trim()).filter(Boolean);
    const validation = await validateActions(credential.connectorSlug, actions, auth.environment.id);
    if (!validation.ok) throw new ApiError(422, "invalid_actions", validation.error);

    const approvalMode = body.approvalMode ?? null;
    if (approvalMode && !["allow", "require_approval", "deny"].includes(approvalMode)) {
      throw new ApiError(422, "invalid_approval_mode", "approvalMode must be allow, require_approval or deny.");
    }

    const existing = await db.grant.findUnique({
      where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
    });
    if (existing) {
      throw new ApiError(409, "grant_exists", "A grant already links this agent to this connection. Update it instead.");
    }

    const justInTime = body.justInTime === true;
    const grant = await db.grant.create({
      data: {
        environmentId: auth.environment.id,
        agentId: agent.id,
        credentialId: credential.id,
        actionsJson: JSON.stringify(actions),
        resourcePattern: body.resourcePattern?.trim() || "*",
        conditionsJson: JSON.stringify(body.conditions ?? {}),
        approvalMode,
        purpose: body.purpose?.trim() || null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        justInTime,
        activatedAt: justInTime ? null : new Date(),
        createdBy: auth.apiKeyId,
      },
    });

    const id = requestId();
    await db.permissionChange.create({
      data: {
        environmentId: auth.environment.id,
        agentId: agent.id,
        credentialId: credential.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        change: "Grant created",
        beforeJson: "{}",
        afterJson: JSON.stringify({ actions, resource: grant.resourcePattern, approvalMode }),
      },
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: agent.id,
      action: "grant.created",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId: id,
      ip: clientIp(req),
      payloadSummary: {
        agent: agent.name,
        connector: credential.connectorSlug,
        actions,
        resource: grant.resourcePattern,
        approvalMode,
        justInTime,
      },
    });

    return apiOk(serializeGrant(grant), { status: 201, requestId: id });
  } catch (error) {
    return handleApiError(error);
  }
}
