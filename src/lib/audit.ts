import { createHash } from "node:crypto";
import { db } from "./db";

export type AuditInput = {
  environmentId: string;
  actorType: "agent" | "human" | "system";
  actorId?: string | null;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "allowed" | "approved" | "denied" | "error" | "recorded";
  requestId?: string;
  ip?: string | null;
  agentId?: string | null;
  payloadSummary?: Record<string, unknown>;
  chain?: { agentId: string; name: string }[];
  timestamp?: Date;
};

const GENESIS = "0".repeat(64);

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function hashEntry(prevHash: string, payload: Record<string, unknown>) {
  return createHash("sha256").update(`${prevHash}:${canonical(payload)}`).digest("hex");
}

export async function auditEvent(input: AuditInput, attempt = 0): Promise<void> {
  const requestId =
    input.requestId ??
    `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.$transaction(async (tx) => {
      // Serialize appends per environment so concurrent writes cannot fork the chain.
      await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.environmentId}))) AS held`;
      const last = await tx.auditEvent.findFirst({
        where: { environmentId: input.environmentId },
        orderBy: { seq: "desc" },
        select: { seq: true, hash: true },
      });
      const prevHash = last?.hash ?? GENESIS;
      const seq = (last?.seq ?? 0) + 1;
      const timestamp = input.timestamp ?? new Date();
      const body = {
        seq,
        timestamp: timestamp.toISOString(),
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome,
        requestId,
        ip: input.ip ?? null,
        agentId: input.agentId ?? null,
        payloadSummary: input.payloadSummary ?? {},
        chain: input.chain ?? [],
      };
      const hash = hashEntry(prevHash, body);
      await tx.auditEvent.create({
        data: {
          environmentId: input.environmentId,
          seq,
          timestamp,
          actorType: body.actorType,
          actorId: body.actorId,
          actorName: body.actorName,
          action: body.action,
          resourceType: body.resourceType,
          resourceId: body.resourceId,
          outcome: body.outcome,
          requestId,
          ip: body.ip,
          agentId: body.agentId,
          payloadSummary: JSON.stringify(body.payloadSummary),
          chainJson: JSON.stringify(body.chain),
          prevHash,
          hash,
        },
      });
    });
  } catch (error) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 30));
      return auditEvent(input, attempt + 1);
    }
    console.error("[authab] audit write failed", error);
    throw error;
  }
}

export async function verifyAuditChain(environmentId: string, fromSeq?: number, toSeq?: number) {
  const events = await db.auditEvent.findMany({
    where: {
      environmentId,
      ...(fromSeq || toSeq
        ? { seq: { ...(fromSeq ? { gte: fromSeq } : {}), ...(toSeq ? { lte: toSeq } : {}) } }
        : {}),
    },
    orderBy: { seq: "asc" },
  });
  if (!events.length) return { valid: true, checked: 0, brokenAt: null as number | null };
  let prev = events[0].prevHash;
  let checked = 0;
  for (const event of events) {
    const body = {
      seq: event.seq,
      timestamp: event.timestamp.toISOString(),
      actorType: event.actorType,
      actorId: event.actorId,
      actorName: event.actorName,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      requestId: event.requestId,
      ip: event.ip,
      agentId: event.agentId,
      payloadSummary: JSON.parse(event.payloadSummary || "{}"),
      chain: JSON.parse(event.chainJson || "[]"),
    };
    const expected = hashEntry(event.prevHash, body);
    if (event.prevHash !== prev || event.hash !== expected) {
      return { valid: false, checked, brokenAt: event.seq };
    }
    prev = event.hash;
    checked += 1;
  }
  return { valid: true, checked, brokenAt: null };
}

export const ACTION_LABELS: Record<string, string> = {
  "auth.signup": "Signed up",
  "auth.login": "Signed in",
  "auth.signed_in": "Signed in",
  "auth.logout": "Signed out",
  "auth.magic_link": "Magic link requested",
  "auth.sso_login": "Signed in with SSO",
  "auth.mfa_enabled": "MFA enabled",
  "auth.mfa_disabled": "MFA disabled",
  "auth.mfa_verified": "MFA verified",
  "auth.mfa_failed": "MFA failed",
  "auth.mfa_recovery_regenerated": "Recovery codes regenerated",
  "scim.user_created": "SCIM user created",
  "scim.user_updated": "SCIM user updated",
  "scim.user_deactivated": "SCIM user deactivated",
  "scim.user_deleted": "SCIM user deprovisioned",
  "sso.connection_saved": "SSO connection saved",
  "sso.connection_deleted": "SSO connection deleted",
  "sso.enforcement_changed": "SSO enforcement changed",
  "sso.metadata_generated": "SAML metadata generated",
  "sink.created": "Audit sink added",
  "sink.updated": "Audit sink updated",
  "sink.deleted": "Audit sink removed",
  "sink.delivered": "Audit stream delivered",
  "sink.failed": "Audit stream delivery failed",
  "billing.trial_started": "Trial started",
  "billing.payment_failed": "Payment failed",
  "billing.recovered": "Billing recovered",
  "sandbox.call": "Sandbox call",
  "agent.registered": "Agent registered",
  "agent.updated": "Agent updated",
  "agent.paused": "Agent paused",
  "agent.resumed": "Agent resumed",
  "agent.suspended": "Agent suspended",
  "agent.revoked": "Agent revoked",
  "agent.kill_switch": "Kill switch activated",
  "agent.key_rotated": "Agent key rotated",
  "agent.transferred": "Agent transferred",
  "token.issued": "Agent token issued",
  "token.exchanged": "Agent token exchanged",
  "token.revoked": "Agent token revoked",
  "agent.client_secret.created": "Client secret issued",
  "agent.client_secret.revoked": "Client secret revoked",
  "workload_identity.created": "Workload identity added",
  "workload_identity.updated": "Workload identity updated",
  "workload_identity.deleted": "Workload identity removed",
  "credential.created": "Credential created",
  "credential.rotated": "Credential rotated",
  "credential.revoked": "Credential revoked",
  "credential.connected": "Connection authorized",
  "credential.refreshed": "Credential token refreshed",
  "credential.checked": "Credential health checked",
  "credential.recovered": "Credential recovered",
  "credential.broken": "Credential marked broken",
  "oauth_app.saved": "OAuth app saved",
  "oauth_app.removed": "OAuth app removed",
  "connector.imported": "Custom connector imported",
  "connector.versioned": "Custom connector versioned",
  "connector.rolled_back": "Custom connector rolled back",
  "connector.archived": "Custom connector archived",
  "credential.used": "Credential used",
  "grant.created": "Grant created",
  "grant.updated": "Grant updated",
  "grant.deleted": "Grant removed",
  "grant.requested": "Just-in-time access requested",
  "grant.activated": "Grant activated",
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
  "approval.escalated": "Approval escalated",
  "proxy.call": "Proxy call",
  "promotion.started": "Promotion started",
  "promotion.completed": "Promoted to production",
  "promotion.rolled_back": "Promotion rolled back",
  "api_key.created": "API key created",
  "api_key.rotated": "API key rotated",
  "api_key.revoked": "API key revoked",
  "webhook.created": "Webhook created",
  "webhook.deleted": "Webhook deleted",
  "settings.updated": "Settings updated",
  "member.invited": "Member invited",
  "member.role_changed": "Member role changed",
  "member.removed": "Member removed",
  "environment.switched": "Environment switched",
  "audit.exported": "Audit log exported",
  "audit.verified": "Audit chain verified",
  "security.updated": "Security settings updated",
  "error.resolved": "Request error resolved",
  "error.resolved_all": "Request errors resolved",
  "incident.created": "Status incident opened",
  "incident.updated": "Status incident updated",
  "incident.resolved": "Status incident resolved",
};

export function actionLabel(action: string) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return action
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
