/** Pure diff helpers behind config apply. Exported so idempotency is unit-tested. */

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function sameSet(a: string[], b: string[]) {
  return stable([...new Set(a)].sort()) === stable([...new Set(b)].sort());
}

export function normalizeActions(actions: string[]) {
  return [...new Set(actions.map((action) => action.trim()).filter(Boolean))].sort();
}

export type AgentConfigShape = {
  agentType: string;
  description: string | null;
  tagsJson: string;
  autonomousMode: boolean;
};

export function agentConfigChanges(
  existing: AgentConfigShape,
  desired: { type?: string; description?: string | null; tags?: string[]; autonomousMode?: boolean },
): string[] {
  const changes: string[] = [];
  if ((desired.type ?? "other") !== existing.agentType) changes.push("type");
  if ((desired.description ?? null) !== (existing.description ?? null)) changes.push("description");
  const existingTags = JSON.parse(existing.tagsJson || "[]") as string[];
  if (!sameSet(existingTags, desired.tags ?? [])) changes.push("tags");
  if ((desired.autonomousMode === true) !== existing.autonomousMode) changes.push("autonomousMode");
  return changes;
}

export type GrantConfigShape = {
  actionsJson: string;
  resourcePattern: string;
  conditionsJson: string;
  approvalMode: string | null;
  expiresAt: Date | null;
};

export function grantConfigChanges(
  existing: GrantConfigShape,
  desired: {
    actions: string[];
    resource: string;
    conditions: Record<string, unknown>;
    approvalMode: string | null;
    expiresAt: Date | null;
  },
): string[] {
  const changes: string[] = [];
  if (!sameSet(JSON.parse(existing.actionsJson || "[]") as string[], desired.actions)) changes.push("actions");
  if (existing.resourcePattern !== desired.resource) changes.push("resource");
  if (stable(JSON.parse(existing.conditionsJson || "{}")) !== stable(desired.conditions)) changes.push("conditions");
  if ((existing.approvalMode ?? null) !== desired.approvalMode) changes.push("approvalMode");
  if ((existing.expiresAt?.toISOString() ?? null) !== (desired.expiresAt?.toISOString() ?? null)) {
    changes.push("expiresAt");
  }
  return changes;
}

export type ApprovalPolicyConfigShape = {
  mode: string;
  slaMinutes: number | null;
  escalateToRole: string | null;
};

export function approvalPolicyConfigChanges(
  existing: ApprovalPolicyConfigShape,
  desired: ApprovalPolicyConfigShape,
): string[] {
  const changes: string[] = [];
  if (existing.mode !== desired.mode) changes.push("mode");
  if ((existing.slaMinutes ?? null) !== (desired.slaMinutes ?? null)) changes.push("slaMinutes");
  if ((existing.escalateToRole ?? null) !== (desired.escalateToRole ?? null)) changes.push("escalateToRole");
  return changes;
}

export function webhookConfigChanges(existingEventsJson: string, desiredEvents: string[]): string[] {
  const existing = JSON.parse(existingEventsJson || "[]") as string[];
  return sameSet(existing, desiredEvents) ? [] : ["events"];
}
