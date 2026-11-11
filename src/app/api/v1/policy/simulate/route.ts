import {
  ApiError,
  apiOk,
  authenticateApiKey,
  handleApiError,
  parseJson,
  requestId,
  requireSecretKey,
} from "@/lib/api";
import { simulatePolicy } from "@/lib/policy";
import { serializeGrant } from "@/lib/serializers";

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);

    const body = await parseJson<{
      agentId?: string;
      credentialId?: string;
      action?: string;
      resource?: string;
      input?: Record<string, unknown>;
      ip?: string;
      now?: string;
    }>(req);

    if (!body.agentId || !body.credentialId || !body.action) {
      throw new ApiError(422, "missing_parameters", "Provide agentId, credentialId and action.");
    }
    if (body.input !== undefined && (typeof body.input !== "object" || Array.isArray(body.input) || body.input === null)) {
      throw new ApiError(422, "invalid_input", "input must be a JSON object.");
    }
    const now = body.now ? new Date(body.now) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ApiError(422, "invalid_time", "now must be an ISO 8601 timestamp.");
    }

    const simulation = await simulatePolicy({
      environment: auth.environment,
      agentId: body.agentId,
      credentialId: body.credentialId,
      actionName: body.action.trim(),
      resource: body.resource,
      input: body.input,
      ip: body.ip ?? null,
      now,
    });
    if (!simulation) {
      throw new ApiError(
        404,
        "simulation_context_not_found",
        "No agent and connection with those IDs exist in this environment.",
      );
    }

    const { decision } = simulation;
    const rid = requestId();
    return apiOk(
      {
        object: "policy_simulation",
        simulated: true,
        evaluatedAt: now.toISOString(),
        decision: {
          effect: decision.effect,
          reason: decision.reason,
          risk: decision.risk,
          source: decision.source,
          wouldExecute: decision.effect === "allow",
          wouldRequestApproval: decision.effect === "require_approval",
        },
        action: decision.action
          ? { name: decision.action.name, label: decision.action.label, risk: decision.action.risk }
          : null,
        grant: decision.grant ? serializeGrant(decision.grant) : null,
        trace: decision.trace ?? [],
        requestId: rid,
      },
      { requestId: rid },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
