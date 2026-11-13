import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateAgent,
  handleApiError,
  parseJson,
  requestId,
} from "@/lib/api";
import { requestJustInTimeGrant } from "@/lib/jit";
import { productionAccess } from "@/lib/limits";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const auth = await authenticateAgent(req);
    const body = await parseJson<{
      credentialId?: string;
      credential?: string;
      connector?: string;
      actions?: string[];
      resourcePattern?: string;
      reason?: string;
      durationMinutes?: number;
    }>(req);

    const connectorSlug = body.connector?.trim();
    const credentialId = body.credentialId || body.credential;
    const credential = credentialId
      ? await db.credential.findFirst({
          where: {
            id: credentialId,
            environmentId: auth.environment.id,
            endUserId: null,
            ...(connectorSlug ? { connectorSlug } : {}),
          },
        })
      : connectorSlug
        ? await db.credential.findFirst({
            where: {
              environmentId: auth.environment.id,
              connectorSlug,
              endUserId: null,
              revokedAt: null,
              status: { not: "revoked" },
            },
            orderBy: { createdAt: "asc" },
          })
        : null;
    if (!credential) {
      throw new ApiError(
        404,
        "credential_not_found",
        "No matching connection exists in this environment. Link one in the vault first.",
      );
    }

    const reason = String(body.reason ?? "").trim();
    if (reason.length < 5) {
      throw new ApiError(422, "reason_required", "Explain why just-in-time access is needed (at least 5 characters).");
    }
    if (reason.length > 500) {
      throw new ApiError(422, "reason_too_long", "Keep the reason under 500 characters.");
    }

    const actions = Array.isArray(body.actions) ? body.actions.map(String) : [];
    if (!actions.length) {
      throw new ApiError(422, "actions_required", "Request at least one action from the connector catalogue.");
    }

    const org = auth.environment.project.org;
    if (auth.environment.type === "production") {
      const access = productionAccess(org.plan, org.planStatus);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }

    const rate = await consumeRateLimit(`grant:request:${auth.agent.id}`, 10);
    if (!rate.allowed) {
      throw new ApiError(429, "rate_limited", "Too many just-in-time requests. Wait a minute before retrying.");
    }

    const rid = requestId();
    const result = await requestJustInTimeGrant({
      environment: auth.environment,
      orgId: org.id,
      agent: auth.agent,
      credential,
      actions,
      resourcePattern: body.resourcePattern,
      reason,
      durationMinutes: body.durationMinutes,
      requestId: rid,
    });
    if (!result.ok) {
      const status = result.code === "grant_exists" || result.code === "grant_active" || result.code === "request_pending" ? 409 : 422;
      throw new ApiError(status, result.code, result.error);
    }

    return apiOk(
      {
        object: "grant_request",
        status: "pending_approval",
        approvalId: result.approvalId,
        grantId: result.grantId,
        approvalUrl: result.approvalUrl,
        expiresAt: result.expiresAt,
        note: "An approver must activate this grant before the proxy will allow calls.",
        requestId: rid,
      },
      { status: 202, requestId: rid },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
