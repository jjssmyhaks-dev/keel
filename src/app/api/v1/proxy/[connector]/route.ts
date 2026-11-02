import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  apiError,
  authenticateAgent,
  clientIp,
  handleApiError,
  parseJson,
  requestId,
} from "@/lib/api";
import { connector } from "@/lib/connectors";
import { evaluatePolicy, envSettings, globMatch } from "@/lib/policy";
import { executeAction } from "@/lib/proxy";
import { createApprovalRequest } from "@/lib/approvals";
import { auditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { serializeApproval } from "@/lib/serializers";
import { checkPlanLimit, productionAccess } from "@/lib/limits";
import { approvalUrlFor } from "@/lib/signed-links";

export async function POST(req: Request, ctx: { params: Promise<{ connector: string }> }) {
  try {
    const auth = await authenticateAgent(req);
    const { connector: connectorSlug } = await ctx.params;
    const connectorDef = connector(connectorSlug);
    if (!connectorDef) throw new ApiError(404, "unknown_connector", `“${connectorSlug}” is not a supported connector.`);

    const body = await parseJson<{
      credentialId?: string;
      credential?: string;
      action?: string;
      resource?: string;
      input?: Record<string, unknown>;
    }>(req);

    const actionName = String(body.action || "").trim();
    if (!actionName) throw new ApiError(422, "action_required", "Provide the connector action to call, e.g. slack.post_message.");

    const credentialId = body.credentialId || body.credential;
    const credential = credentialId
      ? await db.credential.findFirst({
          where: { id: credentialId, environmentId: auth.environment.id, connectorSlug },
        })
      : await db.credential.findFirst({
          where: { environmentId: auth.environment.id, connectorSlug, revokedAt: null, status: { not: "revoked" } },
          orderBy: { createdAt: "asc" },
        });
    if (!credential) {
      throw new ApiError(
        404,
        "credential_not_found",
        `No ${connectorDef.name} connection is available to this agent. Link one in the vault, then grant access.`,
      );
    }
    if (credential.revokedAt || credential.status === "revoked") {
      throw new ApiError(403, "credential_revoked", `The ${connectorDef.name} connection has been revoked. Link a new one before calling it.`);
    }
    if (credential.expiresAt && credential.expiresAt < new Date()) {
      throw new ApiError(403, "credential_expired", `The ${connectorDef.name} connection expired. Rotate it in the vault before calling it.`);
    }

    const org = auth.environment.project.org;
    if (auth.environment.type === "production") {
      const access = productionAccess(org.plan);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }
    const quota = await checkPlanLimit(org.id, "calls", org.plan);
    if (!quota.allowed) {
      throw new ApiError(402, "plan_limit_reached", quota.message, {
        used: quota.used,
        limit: quota.limit,
        plan: quota.plan,
      });
    }

    const settings = envSettings(auth.environment);
    const limit = settings.agentRateLimitPerMinute ?? 120;
    const rate = await consumeRateLimit(`proxy:${auth.agent.id}`, limit);
    if (!rate.allowed) {
      throw new ApiError(429, "rate_limited", `Rate limit of ${limit} calls/minute reached for this agent.`);
    }

    const scopes = Array.isArray(auth.claims.scopes) ? (auth.claims.scopes as string[]) : [];
    if (scopes.length && !scopes.some((scope) => scope === "*" || scope === actionName || globMatch(scope, actionName))) {
      throw new ApiError(403, "scope_not_granted", `The agent token does not include the ${actionName} scope.`);
    }

    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const requestHash = sha256(JSON.stringify({ action: actionName, resource: body.resource ?? null, input: body.input ?? {} }));
    if (idempotencyKey) {
      const existing = await db.idempotencyRecord.findUnique({
        where: { environmentId_key: { environmentId: auth.environment.id, key: idempotencyKey } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ApiError(409, "idempotency_conflict", "This idempotency key was used with a different request body.");
        }
        const stored = JSON.parse(existing.responseJson) as {
          status?: string;
          approval?: { id?: string };
        };
        const approvalId = stored.approval?.id;
        if (approvalId) {
          const approval = await db.approvalRequest.findUnique({ where: { id: approvalId } });
          if (approval && approval.status !== "pending") {
            let execution: unknown = null;
            try {
              execution = approval.executionResult ? JSON.parse(approval.executionResult) : null;
            } catch {
              execution = null;
            }
            if (approval.status === "approved") {
              return apiOk(
                {
                  status: "executed",
                  approval: serializeApproval(approval),
                  result: execution,
                  requestId: approval.requestId,
                },
                { status: 200, headers: { "idempotency-replayed": "true" } },
              );
            }
            if (approval.status === "failed") {
              return apiError(
                502,
                "execution_failed",
                "The approved call failed at the provider.",
                { approvalId, result: execution },
                approval.requestId,
              );
            }
            return apiError(
              403,
              "approval_not_granted",
              `The approval was ${approval.status}.`,
              { approvalId },
              approval.requestId,
            );
          }
        }
        return apiOk(JSON.parse(existing.responseJson), {
          status: existing.statusCode,
          headers: { "idempotency-replayed": "true" },
        });
      }
    }

    const rid = requestId();
    const ip = clientIp(req);

    const decision = await evaluatePolicy({
      environment: auth.environment,
      agent: auth.agent,
      credential,
      actionName,
      resource: body.resource,
      ip,
    });

    const finish = async (status: number, payload: unknown) => {
      if (idempotencyKey) {
        await db.idempotencyRecord
          .create({
            data: {
              environmentId: auth.environment.id,
              key: idempotencyKey,
              requestHash,
              statusCode: status,
              responseJson: JSON.stringify(payload),
            },
          })
          .catch(() => null);
      }
      return apiOk(payload, { status, requestId: rid });
    };

    if (decision.effect === "deny") {
      await auditEvent({
        environmentId: auth.environment.id,
        actorType: "agent",
        actorId: auth.agent.id,
        actorName: auth.agent.name,
        agentId: auth.agent.id,
        action: "proxy.call",
        resourceType: "connector",
        resourceId: connectorDef.slug,
        outcome: "denied",
        requestId: rid,
        ip,
        payloadSummary: {
          action: actionName,
          resource: body.resource,
          credentialId: credential.id,
          risk: decision.risk,
          reason: decision.reason,
          source: decision.source,
          input: body.input ?? {},
        },
      });
      return apiError(
        decision.source === "credential.unhealthy" ? 409 : 403,
        decision.source === "credential.unhealthy" ? "credential_unhealthy" : "policy_denied",
        decision.reason,
        { decision: { effect: "deny", risk: decision.risk, source: decision.source } },
        rid,
      );
    }

    if (decision.effect === "require_approval") {
      const approval = await createApprovalRequest({
        environment: auth.environment,
        agent: auth.agent,
        credential,
        grantId: decision.grant?.id ?? null,
        actionName,
        risk: decision.risk,
        input: body.input ?? {},
        resource: body.resource,
        requestId: rid,
        reason: decision.reason,
      });
      return finish(202, {
        status: "pending_approval",
        approval: serializeApproval(approval),
        approvalUrl: approvalUrlFor(approval.token),
        decision: { effect: decision.effect, risk: decision.risk, source: decision.source, reason: decision.reason },
        requestId: rid,
      });
    }

    const result = await executeAction({
      environment: auth.environment,
      agent: auth.agent,
      credential,
      action: decision.action!,
      input: body.input ?? {},
      resource: body.resource,
      requestId: rid,
      ip,
    });

    return finish(200, {
      status: "executed",
      connector: connectorDef.slug,
      action: actionName,
      result: { status: result.status, body: result.body, latencyMs: result.latencyMs, truncated: result.truncated },
      decision: { effect: "allow", risk: decision.risk, source: decision.source, reason: decision.reason },
      requestId: rid,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
