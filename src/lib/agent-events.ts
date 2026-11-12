import { db } from "./db";

export const AGENT_EVENT_DECISIONS = [
  "allowed",
  "approved",
  "denied",
  "errored",
  "pending_approval",
] as const;
export type AgentEventDecision = (typeof AGENT_EVENT_DECISIONS)[number];

export const DECISION_REASON_CODES = [
  "granted",
  "approval_required",
  "approval_approved",
  "approval_denied",
  "approval_expired",
  "scope_not_granted",
  "rate_limited",
  "agent_inactive",
  "unknown_action",
  "credential_unusable",
  "no_grant",
  "action_not_granted",
  "resource_not_granted",
  "condition_failed",
  "grant_expired",
  "jit_pending",
  "allowed_autonomous",
  "provider_error",
  "provider_auth_failed",
  "internal_error",
] as const;
export type DecisionReasonCode = (typeof DECISION_REASON_CODES)[number];

export const RISK_CLASSES = ["read", "write", "destructive", "financial", "admin"] as const;

/** Every Decision.source emitted by src/lib/policy.ts must map to a reason. */
const SOURCE_REASON: Record<string, DecisionReasonCode> = {
  "agent.status": "agent_inactive",
  connector: "unknown_action",
  "credential.status": "credential_unusable",
  "credential.expired": "credential_unusable",
  "credential.unhealthy": "credential_unusable",
  "grant.missing": "no_grant",
  "grant.actions": "action_not_granted",
  "grant.resource": "resource_not_granted",
  "grant.conditions": "condition_failed",
  "grant.expired": "grant_expired",
  "grant.just_in_time": "jit_pending",
  autonomous: "allowed_autonomous",
};

export const POLICY_SOURCE_REASON_MAP = SOURCE_REASON;

export function mapPolicySource(source: string): DecisionReasonCode {
  return SOURCE_REASON[source] ?? "internal_error";
}

export function upstreamStatusClass(status: number | null | undefined): "2xx" | "3xx" | "4xx" | "5xx" | "none" {
  if (!status || status < 100) return "none";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "none";
}

export function delegationDepthFromClaims(claims: Record<string, unknown> | null | undefined) {
  const chain = claims?.parent_chain;
  return Array.isArray(chain) ? chain.filter((value) => typeof value === "string").length : 0;
}

export function resourceTypeOf(action?: { resourceLabel?: string } | null, connector?: { resourceLabel?: string } | null) {
  return action?.resourceLabel?.trim() || connector?.resourceLabel?.trim() || "resource";
}

export type AgentEventInput = {
  environmentId: string;
  organizationId: string;
  agentId: string;
  agentType?: string | null;
  requestId: string;
  connectorSlug: string;
  action: string;
  riskClass: string;
  resourceType?: string | null;
  decision: AgentEventDecision | string;
  decisionReasonCode: DecisionReasonCode | string;
  approvalLatencyMs?: number | null;
  upstreamStatusClass?: string | null;
  latencyMs?: number | null;
  costUnits?: number;
  delegationDepth?: number;
  isSandbox?: boolean;
  contributes?: boolean;
  credentialId?: string | null;
};

export type AgentEventRow = {
  schemaVersion: number;
  occurredAt: Date;
  environmentId: string;
  organizationId: string;
  agentId: string;
  agentType: string;
  requestId: string;
  connectorSlug: string;
  action: string;
  riskClass: string;
  resourceType: string;
  decision: string;
  decisionReasonCode: string;
  approvalLatencyMs: number | null;
  upstreamStatusClass: string | null;
  latencyMs: number | null;
  costUnits: number;
  delegationDepth: number;
  isSandbox: boolean;
  contributes: boolean;
  credentialId: string | null;
};

/**
 * The only fields an event may carry. Request input, resource text, secrets
 * and user data are never accepted by the writer.
 */
export const AGENT_EVENT_FIELDS = [
  "schemaVersion",
  "occurredAt",
  "environmentId",
  "organizationId",
  "agentId",
  "agentType",
  "requestId",
  "connectorSlug",
  "action",
  "riskClass",
  "resourceType",
  "decision",
  "decisionReasonCode",
  "approvalLatencyMs",
  "upstreamStatusClass",
  "latencyMs",
  "costUnits",
  "delegationDepth",
  "isSandbox",
  "contributes",
  "credentialId",
] as const;

export function buildAgentEventRow(input: AgentEventInput): AgentEventRow {
  const decision = (AGENT_EVENT_DECISIONS as readonly string[]).includes(input.decision)
    ? input.decision
    : "errored";
  const reason = (DECISION_REASON_CODES as readonly string[]).includes(input.decisionReasonCode)
    ? input.decisionReasonCode
    : "internal_error";
  return {
    schemaVersion: 1,
    occurredAt: new Date(),
    environmentId: input.environmentId,
    organizationId: input.organizationId,
    agentId: input.agentId,
    agentType: input.agentType?.trim() || "other",
    requestId: input.requestId,
    connectorSlug: input.connectorSlug,
    action: input.action,
    riskClass: (RISK_CLASSES as readonly string[]).includes(input.riskClass) ? input.riskClass : "write",
    resourceType: input.resourceType?.trim() || "resource",
    decision,
    decisionReasonCode: reason,
    approvalLatencyMs: input.approvalLatencyMs ?? null,
    upstreamStatusClass: input.upstreamStatusClass ?? null,
    latencyMs: input.latencyMs ?? null,
    costUnits: input.costUnits ?? 1,
    delegationDepth: input.delegationDepth ?? 0,
    isSandbox: Boolean(input.isSandbox),
    contributes: Boolean(input.contributes),
    credentialId: input.credentialId ?? null,
  };
}

/**
 * Never throws into the caller: a failed analytics write must not break the
 * proxy call or the approval decision.
 */
export async function recordAgentEvent(input: AgentEventInput): Promise<void> {
  try {
    let contributes = input.contributes;
    if (contributes === undefined) {
      const org = await db.organization.findUnique({
        where: { id: input.organizationId },
        select: { dataContributionEnabled: true },
      });
      contributes = org?.dataContributionEnabled === true;
    }
    let agentType = input.agentType;
    if (!agentType) {
      const agent = await db.agent.findUnique({ where: { id: input.agentId }, select: { agentType: true } });
      agentType = agent?.agentType;
    }
    await db.agentEvent.create({ data: buildAgentEventRow({ ...input, contributes, agentType }) });
  } catch (error) {
    console.error("[authab] agent event write failed", error);
  }
}

/**
 * Shared filter for every aggregation introduced later (policy library,
 * reputation): events written while the organization had contributed, and
 * organizations that still have contribution enabled now.
 */
export async function contributingOrgFilter(
  client: { organization: { findMany(args: any): Promise<any> } } = db,
): Promise<{ contributes: true; organizationId: { in: string[] } }> {
  const orgs = (await client.organization.findMany({
    where: { dataContributionEnabled: true, deletedAt: null },
    select: { id: true },
  })) as { id: string }[];
  return { contributes: true, organizationId: { in: orgs.map((org) => org.id) } };
}

export async function pruneAgentEvents(cutoff: Date, batches = 10, batchSize = 5_000) {
  let deleted = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const rows = await db.agentEvent.findMany({
      where: { occurredAt: { lt: cutoff } },
      select: { id: true },
      take: batchSize,
    });
    if (!rows.length) break;
    const result = await db.agentEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < batchSize) break;
  }
  return deleted;
}
