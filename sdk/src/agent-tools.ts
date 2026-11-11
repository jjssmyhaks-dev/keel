import { createHash } from "node:crypto";
import type { Keel } from "./index";
import type { Connector, ConnectorAction, Grant } from "./types";

export interface AgentToolSpec {
  /** Provider-safe tool name, e.g. slack_post_message. */
  name: string;
  action: string;
  connector: string;
  connectorName: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  credentialId: string;
  resourceKey: string | null;
  resourcePattern: string;
  risk: string;
}

type KeelLike = Pick<Keel, "grants" | "connectors" | "proxy">;

const RISKS = ["read", "write", "destructive", "financial", "admin"] as const;
const MAX_TOOL_NAME = 64;

function escapeRegExp(value: string) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function patternMatches(pattern: string, value: string) {
  const regex = new RegExp(`^${escapeRegExp(pattern).replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  return regex.test(value);
}

function expandActions(actions: ConnectorAction[], patterns: string[]): ConnectorAction[] {
  if (patterns.includes("*")) return [...actions];
  const risks = new Set<string>();
  const exact: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("risk:")) risks.add(pattern.slice(5));
    else if ((RISKS as readonly string[]).includes(pattern)) risks.add(pattern);
    else if (pattern) exact.push(pattern);
  }
  return actions.filter(
    (action) => risks.has(action.risk) || exact.some((pattern) => patternMatches(pattern, action.name)),
  );
}

export function agentToolName(action: string) {
  const clean = action.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "keel_action";
  if (clean.length <= MAX_TOOL_NAME) return clean;
  const digest = createHash("sha256").update(action).digest("hex").slice(0, 8);
  return `${clean.slice(0, MAX_TOOL_NAME - 9)}_${digest}`;
}

function connectorSlug(grant: Grant, actions: string[]) {
  return grant.credential?.connectorSlug ?? actions[0]?.split(".")[0] ?? null;
}

function inputSchemaFor(action: ConnectorAction, resourcePattern: string) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const field of action.fields ?? []) {
    if (!field.key) continue;
    properties[field.key] = {
      type: "string",
      description: field.placeholder ? `${field.label} (e.g. ${field.placeholder})` : field.label,
    };
    if (field.required) required.push(field.key);
  }

  const restricted = resourcePattern.trim() !== "" && resourcePattern.trim() !== "*";
  let resourceKey: string | null = null;
  if (restricted) {
    resourceKey = "resource" in properties ? "_keel_resource" : "resource";
    properties[resourceKey] = {
      type: "string",
      description: `The resource this call applies to. This grant is limited to "${resourcePattern}".`,
    };
    required.push(resourceKey);
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: true,
  };
  if (required.length) schema.required = [...new Set(required)].sort();
  return { schema, resourceKey };
}

function describe(connectorName: string, action: ConnectorAction, resourcePattern: string) {
  let text = `${action.label} on ${connectorName}. ${action.description} Risk: ${action.risk}. Runs through Keel, which enforces grants, approvals and audit.`;
  if (resourcePattern.trim() !== "" && resourcePattern.trim() !== "*") {
    text += ` Resource must match "${resourcePattern}".`;
  }
  return text.slice(0, 1024);
}

/**
 * Expand an agent's grants into one concrete tool per permitted action. The
 * result is framework-neutral and safe to feed to any tool-calling runtime.
 */
export async function buildAgentToolSpecs(
  keel: KeelLike,
  agentId: string,
  options: { connector?: string } = {},
): Promise<AgentToolSpec[]> {
  const [grants, catalog] = await Promise.all([
    keel.grants.list({ agent: agentId }),
    keel.connectors.list(),
  ]);
  const bySlug = new Map(catalog.data.map((connector) => [connector.slug, connector]));

  const specs: AgentToolSpec[] = [];
  const used = new Set<string>();

  for (const grant of grants.data) {
    const slug = connectorSlug(grant, grant.actions);
    if (!slug || (options.connector && slug !== options.connector)) continue;
    const connector = bySlug.get(slug);
    if (!connector) continue;

    const resourcePattern = grant.resourcePattern ?? "";
    for (const action of expandActions(connector.actions, grant.actions)) {
      const base = agentToolName(action.name);
      let name = base;
      let suffix = 2;
      while (used.has(name)) {
        name = `${base.slice(0, MAX_TOOL_NAME - 3)}_${suffix}`;
        suffix += 1;
      }
      used.add(name);

      const { schema, resourceKey } = inputSchemaFor(action, resourcePattern);
      specs.push({
        name,
        action: action.name,
        connector: slug,
        connectorName: connector.name,
        description: describe(connector.name, action, resourcePattern),
        inputSchema: schema,
        credentialId: grant.credentialId,
        resourceKey,
        resourcePattern,
        risk: action.risk,
      });
    }
  }

  return specs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function invokeAgentTool(
  keel: KeelLike,
  spec: AgentToolSpec,
  agentId: string,
  input: Record<string, unknown>,
) {
  const args = { ...(input ?? {}) };
  let resource: string | undefined;

  if (spec.resourceKey) {
    const value = args[spec.resourceKey];
    delete args[spec.resourceKey];
    if (typeof value === "string" && value.trim()) resource = value.trim();
    if (!resource) throw new Error(`${spec.name} requires a resource matching "${spec.resourcePattern}".`);
  } else if (!Object.prototype.hasOwnProperty.call(spec.inputSchema.properties ?? {}, "resource")) {
    const value = args.resource;
    delete args.resource;
    if (typeof value === "string" && value.trim()) resource = value.trim();
  }

  return keel.proxy.call({
    connector: spec.connector,
    action: spec.action,
    resource,
    input: args,
    credentialId: spec.credentialId || undefined,
    agentId,
  });
}
