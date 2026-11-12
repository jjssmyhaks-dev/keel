export const AGENT_TYPES = [
  "support",
  "sales",
  "finance",
  "coding",
  "research",
  "operations",
  "data",
  "other",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && (AGENT_TYPES as readonly string[]).includes(value);
}

export function agentTypeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
