export const STATUS_COMPONENTS = [
  "Control plane",
  "Metadata store",
  "Agent proxy",
  "Audit pipeline",
  "Token signing",
] as const;

export type StatusComponent = (typeof STATUS_COMPONENTS)[number];

export const INCIDENT_IMPACTS = ["minor", "major", "critical", "maintenance"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export const IMPACT_META: Record<IncidentImpact, { label: string; detail: string }> = {
  minor: { label: "Minor", detail: "Reduced functionality, no data loss" },
  major: { label: "Major", detail: "Core workflow unavailable for some customers" },
  critical: { label: "Critical", detail: "Service unavailable for most customers" },
  maintenance: { label: "Maintenance", detail: "Planned or emergency maintenance" },
};

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export function isIncidentImpact(value: string): value is IncidentImpact {
  return (INCIDENT_IMPACTS as readonly string[]).includes(value);
}

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function isStatusComponent(value: string): value is StatusComponent {
  return (STATUS_COMPONENTS as readonly string[]).includes(value);
}

export type IncidentLike = {
  component: string;
  impact: string;
  status: string;
};

const IMPACT_RANK: Record<string, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  maintenance: 1,
};

export function impactRank(impact: string) {
  return IMPACT_RANK[impact] ?? 0;
}

export type OverallState = "operational" | "maintenance" | "degraded" | "outage";

export const OVERALL_META: Record<OverallState, { label: string; headline: string }> = {
  operational: { label: "Operational", headline: "All systems nominal." },
  maintenance: { label: "Maintenance", headline: "Maintenance in progress." },
  degraded: { label: "Degraded", headline: "Degraded performance." },
  outage: { label: "Outage", headline: "Partial outage." },
};

export function overallState(open: IncidentLike[]): OverallState {
  if (!open.length) return "operational";
  if (open.every((incident) => incident.impact === "maintenance")) return "maintenance";
  if (open.some((incident) => incident.impact === "critical")) return "outage";
  return "degraded";
}

export type ComponentState = "operational" | "maintenance" | "degraded";

export function componentState(
  component: string,
  liveOk: boolean,
  open: IncidentLike[],
): ComponentState {
  if (!liveOk) return "degraded";
  const affected = open.filter((incident) => incident.component === component);
  if (affected.some((incident) => incident.impact !== "maintenance")) return "degraded";
  if (affected.length) return "maintenance";
  return "operational";
}

export const COMPONENT_STATE_LABELS: Record<ComponentState, string> = {
  operational: "Operational",
  maintenance: "Maintenance",
  degraded: "Degraded",
};

export function sortOpenIncidents<T extends IncidentLike & { startedAt: Date }>(incidents: T[]) {
  return [...incidents].sort(
    (a, b) => impactRank(b.impact) - impactRank(a.impact) || b.startedAt.getTime() - a.startedAt.getTime(),
  );
}
