import { db } from "./db";

export const POLICY_SUBJECTS = ["grant", "approval_policy", "delegation", "jit_grant"] as const;
export type PolicySubject = (typeof POLICY_SUBJECTS)[number];

export const POLICY_CHANGE_KINDS = ["create", "update", "delete"] as const;
export type PolicyChangeKind = (typeof POLICY_CHANGE_KINDS)[number];

/**
 * any   — no pattern, or "*"
 * single — a plain resource name with no glob characters
 * pattern — anything with a wildcard
 */
export function classifyResourceShape(pattern: string | null | undefined): "any" | "single" | "pattern" {
  const value = (pattern ?? "").trim();
  if (!value || value === "*") return "any";
  if (value.includes("*") || value.includes("?")) return "pattern";
  return "single";
}

export function sortedActionSet(actions: unknown): string[] {
  if (!Array.isArray(actions)) return [];
  return [
    ...new Set(
      actions
        .filter((action): action is string => typeof action === "string")
        .map((action) => action.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function sortedConditionKeys(conditions: unknown): string[] {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return [];
  return Object.keys(conditions as Record<string, unknown>).sort();
}

export type PolicyEventInput = {
  environmentId: string;
  organizationId: string;
  agentId: string;
  agentType?: string | null;
  subject: PolicySubject | string;
  grantId?: string | null;
  approvalPolicyId?: string | null;
  connectorSlug?: string | null;
  actions?: unknown;
  resourcePattern?: string | null;
  approvalMode?: string | null;
  conditions?: unknown;
  changeKind: PolicyChangeKind | string;
  changedFromEventId?: string | null;
  isSandbox?: boolean;
  contributes?: boolean;
};

export type PolicyEventRow = {
  environmentId: string;
  organizationId: string;
  agentId: string;
  agentType: string;
  subject: string;
  grantId: string | null;
  approvalPolicyId: string | null;
  connectorSlug: string | null;
  actionSetJson: string;
  resourceShape: string;
  approvalMode: string | null;
  conditionKeysJson: string;
  changeKind: string;
  changedFromEventId: string | null;
  isSandbox: boolean;
  contributes: boolean;
};

/** Resource text and condition values are deliberately not part of this row. */
export function buildPolicyEventRow(input: PolicyEventInput): PolicyEventRow {
  return {
    environmentId: input.environmentId,
    organizationId: input.organizationId,
    agentId: input.agentId,
    agentType: input.agentType?.trim() || "other",
    subject: (POLICY_SUBJECTS as readonly string[]).includes(input.subject) ? input.subject : "grant",
    grantId: input.grantId ?? null,
    approvalPolicyId: input.approvalPolicyId ?? null,
    connectorSlug: input.connectorSlug ?? null,
    actionSetJson: JSON.stringify(sortedActionSet(input.actions)),
    resourceShape: classifyResourceShape(input.resourcePattern),
    approvalMode: input.approvalMode ?? null,
    conditionKeysJson: JSON.stringify(sortedConditionKeys(input.conditions)),
    changeKind: (POLICY_CHANGE_KINDS as readonly string[]).includes(input.changeKind)
      ? input.changeKind
      : "update",
    changedFromEventId: input.changedFromEventId ?? null,
    isSandbox: Boolean(input.isSandbox),
    contributes: Boolean(input.contributes),
  };
}

/** Never throws into the permission-change path. */
export async function recordPolicyEvent(input: PolicyEventInput): Promise<void> {
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
    if (!agentType && input.agentId) {
      const agent = await db.agent.findUnique({ where: { id: input.agentId }, select: { agentType: true } });
      agentType = agent?.agentType;
    }
    let changedFromEventId = input.changedFromEventId ?? null;
    if (!changedFromEventId && input.changeKind === "update" && (input.grantId || input.approvalPolicyId)) {
      const previous = await db.policyEvent.findFirst({
        where: {
          ...(input.grantId ? { grantId: input.grantId } : {}),
          ...(input.approvalPolicyId ? { approvalPolicyId: input.approvalPolicyId } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      changedFromEventId = previous?.id ?? null;
    }
    await db.policyEvent.create({
      data: buildPolicyEventRow({ ...input, contributes, agentType, changedFromEventId }),
    });
  } catch (error) {
    console.error("[authab] policy event write failed", error);
  }
}
