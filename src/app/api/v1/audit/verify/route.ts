import { authenticateApiKey, apiOk, clientIp, handleApiError } from "@/lib/api";
import { verifyAuditChain, auditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const result = await verifyAuditChain(
      auth.environment.id,
      from ? Number(from) : undefined,
      to ? Number(to) : undefined,
    );

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "audit.verified",
      resourceType: "audit",
      resourceId: null,
      outcome: result.valid ? "recorded" : "error",
      ip: clientIp(req),
      payloadSummary: { valid: result.valid, checked: result.checked, brokenAt: result.brokenAt },
    });

    return apiOk({
      object: "audit_verification",
      environment: auth.environment.type,
      valid: result.valid,
      eventsChecked: result.checked,
      brokenAtSeq: result.brokenAt,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
