import type { Agent, Credential, Environment, Grant } from "@prisma/client";
import { db } from "./db";
import { actionFor, connector, defaultModeForRisk, type ConnectorAction, type Risk } from "./connectors";

export type EnvironmentSettings = {
  autoApproveDev?: boolean;
  approvalExpiryMinutes?: number;
  defaultOutcome?: "deny" | "allow";
  mockMode?: boolean;
  ipAllowlist?: string;
  allowedDomains?: string;
  sessionHours?: number;
  agentRateLimitPerMinute?: number;
  escalateAfterMinutes?: number;
};

export function envSettings(environment: Pick<Environment, "settingsJson">): EnvironmentSettings {
  try {
    return JSON.parse(environment.settingsJson || "{}");
  } catch {
    return {};
  }
}

export type Decision = {
  effect: "allow" | "require_approval" | "deny";
  reason: string;
  risk: Risk;
  action?: ConnectorAction;
  grant?: Grant;
  source: string;
};

export function globMatch(pattern: string, value: string) {
  if (!pattern || pattern === "*") return true;
  const patterns = pattern
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return patterns.some((p) => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(value);
  });
}

function actionPermitted(grantActions: string[], action: ConnectorAction, risk: Risk) {
  if (!grantActions.length) return false;
  if (grantActions.includes("*")) return true;
  return grantActions.some(
    (entry) =>
      entry === action.name ||
      entry === `risk:${risk}` ||
      entry === risk ||
      globMatch(entry, action.name),
  );
}

function withinWindow(conditions: Record<string, unknown>) {
  const start = conditions.timeWindowStart as string | undefined;
  const end = conditions.timeWindowEnd as string | undefined;
  if (!start && !end) return { ok: true };
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value?: string) => {
    if (!value) return null;
    const [h, m] = value.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const s = parse(start);
  const e = parse(end);
  let ok: boolean;
  if (s !== null && e !== null) {
    ok = s <= e ? minutes >= s && minutes <= e : minutes >= s || minutes <= e;
  } else if (s !== null) {
    ok = minutes >= s;
  } else {
    ok = minutes <= (e as number);
  }
  return {
    ok,
    reason: `Allowed only between ${start ?? "00:00"} and ${end ?? "23:59"}`,
  };
}

async function callsInPeriod(agentId: string, actionName: string, hours: number) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const events = await db.auditEvent.findMany({
    where: {
      agentId,
      action: "proxy.call",
      timestamp: { gte: since },
      outcome: { in: ["allowed", "approved"] },
    },
    select: { payloadSummary: true },
    take: 5000,
  });
  return events.filter((event) => {
    try {
      return (JSON.parse(event.payloadSummary) as { action?: string }).action === actionName;
    } catch {
      return false;
    }
  }).length;
}

export async function evaluatePolicy(opts: {
  environment: Environment;
  agent: Agent;
  credential: Credential;
  actionName: string;
  resource?: string;
  ip?: string | null;
}): Promise<Decision> {
  const { environment, agent, credential } = opts;
  const connectorDef = connector(credential.connectorSlug);
  const action = actionFor(credential.connectorSlug, opts.actionName);

  if (!connectorDef) {
    return { effect: "deny", reason: "Unknown connector.", risk: "read", source: "connector" };
  }
  if (!action) {
    return {
      effect: "deny",
      reason: `“${opts.actionName}” is not in the ${connectorDef.name} action catalogue. Unknown actions are blocked.`,
      risk: "read",
      source: "connector",
    };
  }
  const risk = action.risk;

  if (agent.status !== "active") {
    return {
      effect: "deny",
      reason: `Agent is ${agent.status}. Paused and revoked agents cannot call the proxy.`,
      risk,
      action,
      source: "agent.status",
    };
  }

  if (credential.revokedAt || credential.status === "revoked") {
    return {
      effect: "deny",
      reason: "The connection has been revoked.",
      risk,
      action,
      source: "credential.status",
    };
  }

  const grant = await db.grant.findUnique({
    where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
  });
  if (!grant) {
    return {
      effect: "deny",
      reason: `No grant links this agent to the ${connectorDef.name} connection.`,
      risk,
      action,
      source: "grant.missing",
    };
  }
  if (grant.expiresAt && grant.expiresAt < new Date()) {
    return {
      effect: "deny",
      reason: "The grant expired. Extend it from Connections & permissions.",
      risk,
      action,
      grant,
      source: "grant.expired",
    };
  }

  const grantActions: string[] = JSON.parse(grant.actionsJson || "[]");
  if (!actionPermitted(grantActions, action, risk)) {
    return {
      effect: "deny",
      reason: `The grant does not include ${action.label} (${action.name}).`,
      risk,
      action,
      grant,
      source: "grant.actions",
    };
  }

  const restrictedResource = grant.resourcePattern.trim() !== "" && grant.resourcePattern.trim() !== "*";
  if (restrictedResource && !opts.resource) {
    return {
      effect: "deny",
      reason: `This grant is limited to “${grant.resourcePattern}”. Include a resource in the request.`,
      risk,
      action,
      grant,
      source: "grant.resource",
    };
  }
  if (opts.resource && !globMatch(grant.resourcePattern, opts.resource)) {
    return {
      effect: "deny",
      reason: `Resource “${opts.resource}” does not match the grant pattern “${grant.resourcePattern}”.`,
      risk,
      action,
      grant,
      source: "grant.resource",
    };
  }

  let conditions: Record<string, unknown> = {};
  try {
    conditions = JSON.parse(grant.conditionsJson || "{}");
  } catch {
    conditions = {};
  }

  const window = withinWindow(conditions);
  if (!window.ok) {
    return {
      effect: "deny",
      reason: window.reason ?? "Outside the allowed time window.",
      risk,
      action,
      grant,
      source: "grant.conditions",
    };
  }

  if (conditions.maxCallsPerPeriod) {
    const max = Number(conditions.maxCallsPerPeriod);
    const hours = Number(conditions.periodHours ?? 24);
    const used = await callsInPeriod(agent.id, action.name, hours);
    if (withinPeriodLimit(used, max)) {
      return {
        effect: "deny",
        reason: `Call cap reached: ${used} of ${max} calls allowed per ${hours}h.`,
        risk,
        action,
        grant,
        source: "grant.conditions",
      };
    }
  }

  if (conditions.allowedIps && opts.ip) {
    const allowed = String(conditions.allowedIps)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (allowed.length && !allowed.some((ip) => opts.ip!.startsWith(ip))) {
      return {
        effect: "deny",
        reason: `Request IP ${opts.ip} is not in the grant's IP allow-list.`,
        risk,
        action,
        grant,
        source: "grant.conditions",
      };
    }
  }

  let mode: Decision["effect"] | null = null;
  let source = `default.${risk}`;

  if (grant.approvalMode) {
    mode = grant.approvalMode as Decision["effect"];
    source = "grant.approval_mode";
  }

  if (!mode) {
    const policies = await db.approvalPolicy.findMany({
      where: { environmentId: environment.id, OR: [{ agentId: agent.id }, { agentId: null }] },
      orderBy: { agentId: "desc" },
    });
    const match = policies.find((p) => globMatch(p.actionPattern, action.name));
    if (match) {
      mode = match.mode as Decision["effect"];
      source = match.agentId ? "agent.policy" : "environment.policy";
    }
  }

  if (!mode) {
    mode = defaultModeForRisk(risk, environment.type) as Decision["effect"];
    source = `default.${risk}`;
  }

  if (agent.safeLaunchUntil && agent.safeLaunchUntil > new Date() && risk !== "read") {
    mode = "require_approval";
    source = "safe_launch";
  }

  if (mode === "deny") {
    return {
      effect: "deny",
      reason: `Policy ${describeSource(source)} denies ${risk} actions on ${connectorDef.name}.`,
      risk,
      action,
      grant,
      source,
    };
  }

  if (mode === "require_approval") {
    if (agent.autonomousMode) {
      return {
        effect: "allow",
        reason: "Approved automatically by autonomous mode. The call is still fully audited.",
        risk,
        action,
        grant,
        source: "autonomous",
      };
    }
    return {
      effect: "require_approval",
      reason: approvalReason(risk, source, connectorDef.name, action.label),
      risk,
      action,
      grant,
      source,
    };
  }

  return {
    effect: "allow",
    reason: allowReason(risk, source, connectorDef.name, action.label),
    risk,
    action,
    grant,
    source,
  };
}

function withinPeriodLimit(used: number, max: number) {
  return used >= max;
}

function describeSource(source: string) {
  if (source === "grant.approval_mode") return "the grant's approval override";
  if (source === "agent.policy") return "this agent's approval policy";
  if (source === "environment.policy") return "the environment policy";
  return "the default policy";
}

function approvalReason(risk: Risk, source: string, service: string, label: string) {
  if (source === "safe_launch") {
    return `Safe launch mode requires approval for ${risk} actions during the initial production period.`;
  }
  if (source === "grant.approval_mode" || source.endsWith(".policy")) {
    return `${label} on ${service} needs approval under ${describeSource(source)}.`;
  }
  if (risk === "financial") {
    return `Financial actions always require approval. ${label} on ${service} moves money or spend.`;
  }
  if (risk === "destructive") {
    return `Destructive actions require human approval. ${label} can remove or overwrite data in ${service}.`;
  }
  if (risk === "admin") {
    return `Admin actions require human approval. ${label} changes access, configuration or infrastructure in ${service}.`;
  }
  return `Write actions require approval in production. ${label} would change data in ${service}.`;
}

function allowReason(risk: Risk, source: string, service: string, label: string) {
  if (source === "grant.approval_mode" || source.endsWith(".policy")) {
    return `Allowed by ${describeSource(source)}. ${label} is permitted on ${service}.`;
  }
  if (risk === "read") return `Read actions are auto-allowed by default. ${label} does not change data.`;
  return `Allowed by policy. ${label} on ${service} is covered by the agent's grant.`;
}

export async function policyPreview(opts: {
  environment: Environment;
  agentId: string;
  credentialId: string;
  actionName: string;
  resource?: string;
}) {
  const agent = await db.agent.findUnique({ where: { id: opts.agentId } });
  const credential = await db.credential.findUnique({ where: { id: opts.credentialId } });
  if (!agent || !credential) return null;
  return evaluatePolicy({
    environment: opts.environment,
    agent,
    credential,
    actionName: opts.actionName,
    resource: opts.resource,
  });
}
