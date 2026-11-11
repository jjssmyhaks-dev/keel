import type { Agent, Credential, Environment, Grant } from "@prisma/client";
import { isIPv4, isIPv6 } from "node:net";
import { db } from "./db";
import { defaultModeForRisk, type Connector, type ConnectorAction, type Risk } from "./connectors";
import { resolveConnector } from "./custom-connectors";

export type EnvironmentSettings = {
  autoApproveDev?: boolean;
  approvalExpiryMinutes?: number;
  defaultOutcome?: "deny" | "allow";
  ipAllowlist?: string;
  allowedDomains?: string;
  sessionHours?: number;
  agentRateLimitPerMinute?: number;
  escalateAfterMinutes?: number;
  slackWebhookUrl?: string;
};

export function envSettings(environment: Pick<Environment, "settingsJson">): EnvironmentSettings {
  try {
    return JSON.parse(environment.settingsJson || "{}");
  } catch {
    return {};
  }
}

export type PolicyTraceStep = {
  check: string;
  outcome: "pass" | "fail" | "skip";
  detail: string;
};

export type Decision = {
  effect: "allow" | "require_approval" | "deny";
  reason: string;
  risk: Risk;
  action?: ConnectorAction;
  grant?: Grant;
  source: string;
  trace?: PolicyTraceStep[];
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

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function clockInZone(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hours = Number(get("hour"));
  const minutes = Number(get("minute"));
  const day = DAY_NAMES.indexOf(get("weekday").toLowerCase());
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || day < 0) return null;
  return { minutes: hours * 60 + minutes, day };
}

function parseDayToken(token: string): number | null {
  const value = token.trim().toLowerCase();
  if (!value) return null;
  if (/^[0-6]$/.test(value)) return Number(value);
  if (value.length >= 3) {
    const index = DAY_NAMES.indexOf(value.slice(0, 3));
    if (index >= 0) return index;
  }
  return null;
}

type ConditionCheck = { ok: boolean; reason?: string; detail: string };

export function withinTimeWindow(conditions: Record<string, unknown>, now: Date): ConditionCheck {
  for (const key of ["timeWindowStart", "timeWindowEnd", "allowedDays", "timezone"]) {
    const raw = conditions[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") {
      return {
        ok: false,
        reason: `${key} must be a string. Failing closed.`,
        detail: `Invalid ${key}.`,
      };
    }
  }
  const startRaw = typeof conditions.timeWindowStart === "string" ? conditions.timeWindowStart : "";
  const endRaw = typeof conditions.timeWindowEnd === "string" ? conditions.timeWindowEnd : "";
  const daysRaw = typeof conditions.allowedDays === "string" ? conditions.allowedDays : "";
  const timeZoneRaw = typeof conditions.timezone === "string" ? conditions.timezone.trim() : "";
  const timeZone = timeZoneRaw || "UTC";
  const hasWindow = Boolean(startRaw || endRaw || daysRaw);
  if (!hasWindow && !timeZoneRaw) {
    return { ok: true, detail: "No time, day or timezone conditions." };
  }

  let clock: { minutes: number; day: number } | null;
  try {
    clock = clockInZone(now, timeZone);
  } catch {
    return { ok: false, reason: `The grant's timezone “${timeZone}” is not a valid IANA timezone. Failing closed.`, detail: "Invalid timezone." };
  }
  if (!clock) {
    return { ok: false, reason: "Could not resolve the current time in the grant's timezone. Failing closed.", detail: "Unreadable clock." };
  }
  if (!hasWindow) {
    return { ok: true, detail: `No time or day restriction (${timeZone}).` };
  }

  if (daysRaw) {
    const days = daysRaw
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
    const parsed = days.map(parseDayToken);
    if (!days.length || parsed.some((day) => day === null)) {
      return { ok: false, reason: `allowedDays must be weekday names or 0–6 (Sunday=0). Got “${daysRaw}”.`, detail: "Invalid allowedDays." };
    }
    if (!(parsed as number[]).includes(clock.day)) {
      return {
        ok: false,
        reason: `Today (${DAY_NAMES[clock.day]}) is outside the grant's allowed days (${days.join(", ")}).`,
        detail: `Day ${DAY_NAMES[clock.day]} not allowed.`,
      };
    }
  }

  const start = startRaw ? parseClock(startRaw) : null;
  const end = endRaw ? parseClock(endRaw) : null;
  if (startRaw && start === null) {
    return { ok: false, reason: `timeWindowStart must be HH:MM (got “${startRaw}”).`, detail: "Invalid start time." };
  }
  if (endRaw && end === null) {
    return { ok: false, reason: `timeWindowEnd must be HH:MM (got “${endRaw}”).`, detail: "Invalid end time." };
  }

  if (start !== null || end !== null) {
    const minutes = clock.minutes;
    let inside: boolean;
    if (start !== null && end !== null) {
      inside = start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
    } else if (start !== null) {
      inside = minutes >= start;
    } else {
      inside = minutes <= (end as number);
    }
    if (!inside) {
      return {
        ok: false,
        reason: `Calls are allowed only between ${startRaw || "00:00"} and ${endRaw || "23:59"} ${timeZone}.`,
        detail: `Outside time window (${timeZone}).`,
      };
    }
  }

  const windowText = start !== null || end !== null ? ` between ${startRaw || "00:00"} and ${endRaw || "23:59"}` : "";
  const dayText = daysRaw ? ` on ${daysRaw}` : "";
  return { ok: true, detail: `Inside the allowed window${windowText}${dayText} (${timeZone}).` };
}

export function normalizeIp(value: string): string {
  let ip = value.trim();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    ip = ip.slice(1, end === -1 ? undefined : end);
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let address = ip;
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);
  if (!address.includes(":")) return null;
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const embedded = ipv4ToBigInt(address.slice(lastColon + 1));
    if (embedded === null) return null;
    const high = ((embedded >> 16n) & 0xffffn).toString(16);
    const low = (embedded & 0xffffn).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill("0") : []), ...tail];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipToBigInt(ip: string): { bits: 32 | 128; value: bigint } | null {
  const normalized = normalizeIp(ip);
  if (isIPv4(normalized)) {
    const value = ipv4ToBigInt(normalized);
    return value === null ? null : { bits: 32, value };
  }
  if (isIPv6(normalized)) {
    const value = ipv6ToBigInt(normalized);
    return value === null ? null : { bits: 128, value };
  }
  return null;
}

function normalizeCidrRule(rule: string): string | null {
  const value = rule.trim();
  if (!value) return null;
  if (value.includes("/")) return value;
  if (isIPv4(value) || isIPv6(value)) return value;
  // Legacy dotted-prefix support: "10.0.0." previously matched as a string prefix.
  const legacy = /^(\d{1,3}(?:\.\d{1,3}){0,2})\.$/.exec(value);
  if (legacy) {
    const octets = legacy[1].split(".").filter(Boolean).length;
    return `${legacy[1]}${".0".repeat(4 - octets)}/${octets * 8}`;
  }
  return null;
}

export function cidrMatch(ip: string, cidr: string): boolean {
  const rule = normalizeCidrRule(cidr);
  if (!rule) return false;
  const address = ipToBigInt(ip);
  if (!address) return false;
  if (!rule.includes("/")) {
    const exact = ipToBigInt(rule);
    return Boolean(exact && exact.bits === address.bits && exact.value === address.value);
  }
  const [base, bitsRaw] = rule.split("/");
  const baseAddress = ipToBigInt(base);
  if (!baseAddress || baseAddress.bits !== address.bits) return false;
  if (!/^\d{1,3}$/.test(bitsRaw)) return false;
  const bits = Number(bitsRaw);
  const max = address.bits;
  if (bits > max) return false;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
  return (address.value & mask) === (baseAddress.value & mask);
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = input;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

type AmountCheck = { ok: boolean; reason?: string; detail: string; amount: number | null; maxAmount: number | null; approvalAbove: number | null };

function amountCondition(conditions: Record<string, unknown>, input: Record<string, unknown>): AmountCheck {
  const rawMax = conditions.maxAmount;
  const rawApproval = conditions.approvalAboveAmount;
  if (rawMax === undefined && rawApproval === undefined) {
    return { ok: true, detail: "No amount conditions.", amount: null, maxAmount: null, approvalAbove: null };
  }
  const maxAmount = rawMax === undefined ? null : Number(rawMax);
  const approvalAbove = rawApproval === undefined ? null : Number(rawApproval);
  const validMax = maxAmount === null || (Number.isFinite(maxAmount) && maxAmount >= 0);
  const validApproval = approvalAbove === null || (Number.isFinite(approvalAbove) && approvalAbove >= 0);
  if (!validMax || !validApproval) {
    return { ok: false, reason: "maxAmount and approvalAboveAmount must be non-negative numbers.", detail: "Invalid amount condition.", amount: null, maxAmount, approvalAbove };
  }
  const field = typeof conditions.amountField === "string" && conditions.amountField.trim() ? conditions.amountField.trim() : "amount";
  const raw = readPath(input, field);
  const amount = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : typeof raw === "number" ? raw : null;
  if (amount === null || !Number.isFinite(amount)) {
    return {
      ok: false,
      reason: `This grant has amount conditions but the request did not include a numeric “${field}”. Failing closed.`,
      detail: `Missing numeric amount at “${field}”.`,
      amount: null,
      maxAmount,
      approvalAbove,
    };
  }
  if (maxAmount !== null && amount > maxAmount) {
    return {
      ok: false,
      reason: `Amount ${amount} exceeds the grant's ceiling of ${maxAmount}.`,
      detail: `Amount ${amount} > maxAmount ${maxAmount}.`,
      amount,
      maxAmount,
      approvalAbove,
    };
  }
  const ceiling = maxAmount !== null ? ` max ${maxAmount}` : "";
  const approval = approvalAbove !== null ? `, approval at ${approvalAbove}` : "";
  return { ok: true, detail: `Amount ${amount}${ceiling}${approval}.`, amount, maxAmount, approvalAbove };
}

async function callsInPeriod(agentId: string, actionName: string, hours: number, now: Date) {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const rows = await db.$queryRaw<{ count: bigint | number }[]>`
    SELECT COUNT(*) AS count FROM "AuditEvent"
    WHERE "agentId" = ${agentId}
      AND action IN ('proxy.call', 'sandbox.call')
      AND timestamp >= ${since}
      AND outcome IN ('allowed', 'approved')
      AND (COALESCE(NULLIF("payloadSummary", ''), '{}')::jsonb ->> 'action') = ${actionName}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function evaluatePolicy(opts: {
  environment: Environment;
  agent: Agent;
  credential: Credential;
  actionName: string;
  resource?: string;
  ip?: string | null;
  input?: Record<string, unknown>;
  now?: Date;
  trace?: boolean;
  connectorDef?: Connector | null;
}): Promise<Decision> {
  const { environment, agent, credential } = opts;
  const now = opts.now ?? new Date();
  const input = opts.input ?? {};
  const trace: PolicyTraceStep[] = [];
  const mark = (check: string, outcome: PolicyTraceStep["outcome"], detail: string) => {
    if (opts.trace) trace.push({ check, outcome, detail });
  };
  const finish = (decision: Decision): Decision => (opts.trace ? { ...decision, trace } : decision);

  const connectorDef =
    opts.connectorDef !== undefined ? opts.connectorDef : await resolveConnector(credential.connectorSlug, environment.id);
  const action = connectorDef?.actions.find((entry) => entry.name === opts.actionName);

  if (!connectorDef) {
    mark("connector", "fail", "No connector definition matched the credential.");
    return finish({ effect: "deny", reason: "Unknown connector.", risk: "read", source: "connector" });
  }
  mark("connector", "pass", `Resolved ${connectorDef.name} (${connectorDef.slug}).`);
  if (!action) {
    mark("action", "fail", `“${opts.actionName}” is not in the catalogue.`);
    return finish({
      effect: "deny",
      reason: `“${opts.actionName}” is not in the ${connectorDef.name} action catalogue. Unknown actions are blocked.`,
      risk: "read",
      source: "connector",
    });
  }
  const risk = action.risk;
  mark("action", "pass", `${action.name} is a ${risk} action.`);

  if (agent.status !== "active") {
    mark("agent.status", "fail", `Agent is ${agent.status}.`);
    return finish({
      effect: "deny",
      reason: `Agent is ${agent.status}. Paused and revoked agents cannot call the proxy.`,
      risk,
      action,
      source: "agent.status",
    });
  }
  mark("agent.status", "pass", "Agent is active.");

  if (credential.revokedAt || credential.status === "revoked") {
    mark("credential.status", "fail", "The connection was revoked.");
    return finish({
      effect: "deny",
      reason: "The connection has been revoked.",
      risk,
      action,
      source: "credential.status",
    });
  }

  if (credential.expiresAt && credential.expiresAt < now) {
    mark("credential.status", "fail", "The connection expired.");
    return finish({
      effect: "deny",
      reason: "The connection expired. Rotate it in the vault before calling it.",
      risk,
      action,
      source: "credential.expired",
    });
  }

  if (credential.status === "broken") {
    mark("credential.status", "fail", "The provider rejected this credential.");
    return finish({
      effect: "deny",
      reason: credential.healthDetail ?? "The provider rejected this credential. Rotate it in the vault.",
      risk,
      action,
      source: "credential.unhealthy",
    });
  }
  mark("credential.status", "pass", "Connection is active and healthy.");

  const grant = await db.grant.findUnique({
    where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
  });
  if (!grant) {
    mark("grant", "fail", "No grant links the agent to this connection.");
    return finish({
      effect: "deny",
      reason: `No grant links this agent to the ${connectorDef.name} connection.`,
      risk,
      action,
      source: "grant.missing",
    });
  }
  if (grant.expiresAt && grant.expiresAt < now) {
    mark("grant", "fail", `The grant expired on ${grant.expiresAt.toISOString()}.`);
    return finish({
      effect: "deny",
      reason: "The grant expired. Extend it from Connections & permissions.",
      risk,
      action,
      grant,
      source: "grant.expired",
    });
  }
  if (grant.justInTime && !grant.activatedAt) {
    mark("grant.just_in_time", "fail", "Just-in-time grant has not been activated.");
    return finish({
      effect: "deny",
      reason: "This is a just-in-time grant that has not been activated yet. Request activation and wait for an approver.",
      risk,
      action,
      grant,
      source: "grant.just_in_time",
    });
  }
  mark("grant", "pass", grant.justInTime ? "Just-in-time grant is active." : "Grant is active.");

  const grantActions: string[] = JSON.parse(grant.actionsJson || "[]");
  if (!actionPermitted(grantActions, action, risk)) {
    mark("grant.actions", "fail", `The grant covers ${grantActions.join(", ") || "no actions"}.`);
    return finish({
      effect: "deny",
      reason: `The grant does not include ${action.label} (${action.name}).`,
      risk,
      action,
      grant,
      source: "grant.actions",
    });
  }
  mark("grant.actions", "pass", `${action.name} is covered by the grant.`);

  const restrictedResource = grant.resourcePattern.trim() !== "" && grant.resourcePattern.trim() !== "*";
  if (restrictedResource && !opts.resource) {
    mark("grant.resource", "fail", "A resource is required by the grant but was not supplied.");
    return finish({
      effect: "deny",
      reason: `This grant is limited to “${grant.resourcePattern}”. Include a resource in the request.`,
      risk,
      action,
      grant,
      source: "grant.resource",
    });
  }
  if (opts.resource && !globMatch(grant.resourcePattern, opts.resource)) {
    mark("grant.resource", "fail", `Resource “${opts.resource}” does not match “${grant.resourcePattern}”.`);
    return finish({
      effect: "deny",
      reason: `Resource “${opts.resource}” does not match the grant pattern “${grant.resourcePattern}”.`,
      risk,
      action,
      grant,
      source: "grant.resource",
    });
  }
  mark("grant.resource", "pass", opts.resource ? `Resource “${opts.resource}” matches the grant.` : "No resource restriction.");

  let conditions: Record<string, unknown> = {};
  try {
    conditions = JSON.parse(grant.conditionsJson || "{}");
  } catch {
    conditions = {};
  }

  const window = withinTimeWindow(conditions, now);
  if (!window.ok) {
    mark("conditions.time", "fail", window.detail);
    return finish({
      effect: "deny",
      reason: window.reason ?? "Outside the allowed time window.",
      risk,
      action,
      grant,
      source: "grant.conditions",
    });
  }
  mark("conditions.time", "pass", window.detail);

  const amount = amountCondition(conditions, input);
  if (!amount.ok) {
    mark("conditions.amount", "fail", amount.detail);
    return finish({
      effect: "deny",
      reason: amount.reason ?? "Amount condition failed.",
      risk,
      action,
      grant,
      source: "grant.conditions",
    });
  }
  mark("conditions.amount", "pass", amount.detail);

  if (conditions.allowedIps) {
    const requestIp = opts.ip ? normalizeIp(opts.ip) : "";
    if (!requestIp) {
      mark("conditions.ip", "fail", "The grant restricts IPs but the request has no client IP.");
      return finish({
        effect: "deny",
        reason: "This grant restricts IPs, but the request did not include a client IP. Failing closed.",
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    const rules = String(conditions.allowedIps)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = rules.find((rule) => normalizeCidrRule(rule) === null);
    if (!rules.length || invalid) {
      mark("conditions.ip", "fail", invalid ? `Invalid CIDR entry “${invalid}”.` : "Empty IP allow-list.");
      return finish({
        effect: "deny",
        reason: invalid
          ? `The grant's IP allow-list contains an invalid entry (${invalid}). Failing closed.`
          : "The grant's IP allow-list is empty. Failing closed.",
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    if (!rules.some((rule) => cidrMatch(requestIp, rule))) {
      mark("conditions.ip", "fail", `Request IP ${requestIp} is not in ${rules.join(", ")}.`);
      return finish({
        effect: "deny",
        reason: `Request IP ${requestIp} is not in the grant's IP allow-list.`,
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    mark("conditions.ip", "pass", `Request IP ${requestIp} matches the allow-list.`);
  } else {
    mark("conditions.ip", "skip", "No IP restriction.");
  }

  const rawMaxCalls = conditions.maxCallsPerPeriod;
  const hasMaxCalls = rawMaxCalls !== undefined && rawMaxCalls !== null && rawMaxCalls !== "";
  if (hasMaxCalls) {
    const max = Number(rawMaxCalls);
    const rawHours = conditions.periodHours;
    const hasPeriod = rawHours !== undefined && rawHours !== null && rawHours !== "";
    const hours = hasPeriod ? Number(rawHours) : 24;
    if (!Number.isFinite(max) || max <= 0) {
      mark("conditions.rate", "fail", "maxCallsPerPeriod is not a positive number.");
      return finish({
        effect: "deny",
        reason: "The grant's maxCallsPerPeriod condition is invalid. Failing closed.",
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      mark("conditions.rate", "fail", "periodHours is not a positive number.");
      return finish({
        effect: "deny",
        reason: "The grant's periodHours condition is invalid. Failing closed.",
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    const used = await callsInPeriod(agent.id, action.name, hours, now);
    if (withinPeriodLimit(used, max)) {
      mark("conditions.rate", "fail", `${used} of ${max} calls used in ${hours}h.`);
      return finish({
        effect: "deny",
        reason: `Call cap reached: ${used} of ${max} calls allowed per ${hours}h.`,
        risk,
        action,
        grant,
        source: "grant.conditions",
      });
    }
    mark("conditions.rate", "pass", `${used} of ${max} calls used in ${hours}h.`);
  } else {
    mark("conditions.rate", "skip", "No call cap.");
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
      orderBy: { agentId: { sort: "desc", nulls: "last" } },
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
  mark("mode", "pass", `Base decision ${mode} from ${describeSource(source)}.`);

  if (agent.safeLaunchUntil && agent.safeLaunchUntil > now && risk !== "read") {
    mode = "require_approval";
    source = "safe_launch";
    mark("safe_launch", "pass", "Safe launch forces approval for non-read actions.");
  } else {
    mark("safe_launch", "skip", "Not in safe launch or action is read-only.");
  }

  const forcedByAmount =
    amount.approvalAbove !== null &&
    amount.amount !== null &&
    amount.amount >= amount.approvalAbove &&
    mode !== "deny";
  if (forcedByAmount) {
    mode = "require_approval";
    source = "grant.conditions.amount";
    mark("conditions.amount_approval", "pass", `Amount ${amount.amount} ≥ ${amount.approvalAbove} requires approval.`);
  } else {
    mark("conditions.amount_approval", "skip", "No amount approval threshold triggered.");
  }

  if (mode === "deny") {
    mark("decision", "fail", `Denied by ${describeSource(source)}.`);
    return finish({
      effect: "deny",
      reason: `Policy ${describeSource(source)} denies ${risk} actions on ${connectorDef.name}.`,
      risk,
      action,
      grant,
      source,
    });
  }

  if (mode === "require_approval") {
    if (agent.autonomousMode && !forcedByAmount) {
      mark("autonomous", "pass", "Autonomous mode auto-approved the request; the call is audited.");
      return finish({
        effect: "allow",
        reason: "Approved automatically by autonomous mode. The call is still fully audited.",
        risk,
        action,
        grant,
        source: "autonomous",
      });
    }
    if (agent.autonomousMode && forcedByAmount) {
      mark("autonomous", "skip", "Autonomous mode cannot bypass the grant's amount threshold.");
    }
    mark("decision", "pass", "Human approval required.");
    return finish({
      effect: "require_approval",
      reason: forcedByAmount
        ? `Amount ${amount.amount} is at or above the grant's approval threshold of ${amount.approvalAbove}. A human must approve.`
        : approvalReason(risk, source, connectorDef.name, action.label),
      risk,
      action,
      grant,
      source,
    });
  }

  mark("decision", "pass", "Allowed.");
  return finish({
    effect: "allow",
    reason: allowReason(risk, source, connectorDef.name, action.label),
    risk,
    action,
    grant,
    source,
  });
}

function withinPeriodLimit(used: number, max: number) {
  return used >= max;
}

function describeSource(source: string) {
  if (source === "grant.approval_mode") return "the grant's approval override";
  if (source === "grant.conditions.amount") return "the grant's amount condition";
  if (source === "agent.policy") return "this agent's approval policy";
  if (source === "environment.policy") return "the environment policy";
  return "the default policy";
}

function approvalReason(risk: Risk, source: string, service: string, label: string) {
  if (source === "safe_launch") {
    return `Safe launch mode requires approval for ${risk} actions during the initial production period.`;
  }
  if (source === "grant.approval_mode" || source.endsWith(".policy") || source === "grant.conditions.amount") {
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

export async function simulatePolicy(opts: {
  environment: Environment;
  agentId: string;
  credentialId: string;
  actionName: string;
  resource?: string;
  input?: Record<string, unknown>;
  ip?: string | null;
  now?: Date;
}) {
  const [agent, credential] = await Promise.all([
    db.agent.findFirst({ where: { id: opts.agentId, environmentId: opts.environment.id } }),
    db.credential.findFirst({ where: { id: opts.credentialId, environmentId: opts.environment.id } }),
  ]);
  if (!agent || !credential) return null;
  const decision = await evaluatePolicy({
    environment: opts.environment,
    agent,
    credential,
    actionName: opts.actionName,
    resource: opts.resource,
    input: opts.input,
    ip: opts.ip,
    now: opts.now,
    trace: true,
  });
  return { agent, credential, decision };
}

export async function approvalSlaFor(opts: {
  environmentId: string;
  agentId?: string | null;
  actionName: string;
  fallbackMinutes?: number | null;
}): Promise<{ minutes: number | null; escalateToRole: string | null; policyId: string | null }> {
  const policies = await db.approvalPolicy.findMany({
    where: {
      environmentId: opts.environmentId,
      ...(opts.agentId ? { OR: [{ agentId: opts.agentId }, { agentId: null }] } : { agentId: null }),
    },
    orderBy: { agentId: { sort: "desc", nulls: "last" } },
  });
  const match = policies.find((policy) => globMatch(policy.actionPattern, opts.actionName));
  const explicit = match?.slaMinutes && match.slaMinutes > 0 ? match.slaMinutes : null;
  const fallback = opts.fallbackMinutes && opts.fallbackMinutes > 0 ? opts.fallbackMinutes : null;
  return {
    minutes: explicit ?? fallback,
    escalateToRole: match?.escalateToRole ?? null,
    policyId: match?.id ?? null,
  };
}
