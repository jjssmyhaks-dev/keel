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
import { auditEvent } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import {
  CONSENT_REQUEST_DEFAULT_MINUTES,
  CONSENT_REQUEST_MAX_MINUTES,
  consentTokenHash,
  consentUrl,
  upsertEndUser,
  validateConsentRequest,
} from "@/lib/consent";

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      agentId?: string;
      scopes?: string[];
      connectors?: string[];
      endUser?: { externalUserId?: string; email?: string | null };
      redirectUri?: string;
      state?: string;
      expiresInMinutes?: number;
      durationOptions?: string[];
    }>(req);

    const agentId = body.agentId?.trim();
    if (!agentId) throw new ApiError(422, "agent_required", "Provide the agent that will act for the end user.");
    const redirectUri = body.redirectUri?.trim();
    if (!redirectUri) throw new ApiError(422, "redirect_required", "Provide the redirectUri to return the end user to.");
    const externalUserId = body.endUser?.externalUserId?.trim();
    if (!externalUserId) throw new ApiError(422, "end_user_required", "Provide endUser.externalUserId.");

    const minutes = body.expiresInMinutes ?? CONSENT_REQUEST_DEFAULT_MINUTES;
    if (
      !Number.isFinite(minutes) ||
      Math.floor(minutes) < 5 ||
      Math.floor(minutes) > CONSENT_REQUEST_MAX_MINUTES
    ) {
      throw new ApiError(
        422,
        "invalid_expiry",
        `expiresInMinutes must be between 5 and ${CONSENT_REQUEST_MAX_MINUTES}.`,
      );
    }

    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    const validated = await validateConsentRequest({
      environmentId: auth.environment.id,
      projectId: auth.project.id,
      environmentType: auth.environment.type,
      agentId,
      scopes,
      connectors: Array.isArray(body.connectors) ? body.connectors.map(String) : undefined,
      redirectUri,
      durationOptions: Array.isArray(body.durationOptions) ? body.durationOptions.map(String) : undefined,
    });

    const endUser = await upsertEndUser(auth.project.id, externalUserId, body.endUser?.email ?? null);
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + Math.floor(minutes) * 60_000);
    const state = body.state?.trim().slice(0, 200) || null;

    const request = await db.consentRequest.create({
      data: {
        projectId: auth.project.id,
        environmentId: auth.environment.id,
        agentId: validated.agent.id,
        endUserId: endUser.id,
        externalUserId,
        email: endUser.email,
        scopesJson: JSON.stringify(validated.scopes),
        connectorSlugsJson: JSON.stringify(validated.connectors),
        redirectUri,
        state,
        tokenHash: consentTokenHash(token),
        status: "pending",
        durationOptionsJson: JSON.stringify(validated.durationOptions),
        expiresAt,
      },
    });

    const rid = requestId();
    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      agentId: validated.agent.id,
      action: "consent.request_created",
      resourceType: "consent_request",
      resourceId: request.id,
      outcome: "recorded",
      requestId: rid,
      ip: clientIp(req),
      payloadSummary: {
        agent: validated.agent.name,
        endUser: { id: endUser.id, externalUserId },
        scopes: validated.scopes,
        connectors: validated.connectors,
        redirectHost: new URL(redirectUri).host,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return apiOk(
      {
        id: request.id,
        url: consentUrl(token),
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201, requestId: rid },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
