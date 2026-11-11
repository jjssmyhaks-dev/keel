import type { Connector } from "./connectors";
import { globMatch } from "./policy";

export type GatewayRisk = "read" | "write" | "destructive" | "financial" | "admin";

export interface GatewayGrant {
  credentialId: string;
  actions: string[];
  resourcePattern: string;
  connectorSlug: string;
  credentialName?: string;
}

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  connector: string;
  action: string;
  credentialId: string;
  resourceKey: string | null;
  resourcePattern: string;
  risk: GatewayRisk;
}

export class GatewayToolInputError extends Error {}

const MAX_TOOL_NAME = 64;
const RISKS: GatewayRisk[] = ["read", "write", "destructive", "financial", "admin"];

export function gatewayToolName(action: string) {
  const clean = action.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "keel_action";
  if (clean.length <= MAX_TOOL_NAME) return clean;
  let hash = 0;
  for (let index = 0; index < action.length; index += 1) {
    hash = (hash * 31 + action.charCodeAt(index)) >>> 0;
  }
  return `${clean.slice(0, MAX_TOOL_NAME - 9)}_${hash.toString(16).padStart(8, "0").slice(0, 8)}`;
}

export function expandGrantActions(connector: Pick<Connector, "actions">, patterns: string[]) {
  if (patterns.includes("*")) return [...connector.actions];
  const risks = new Set<string>();
  const exact: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("risk:")) risks.add(pattern.slice(5));
    else if (RISKS.includes(pattern as GatewayRisk)) risks.add(pattern);
    else if (pattern) exact.push(pattern);
  }
  return connector.actions.filter(
    (action) => risks.has(action.risk) || exact.some((pattern) => globMatch(pattern, action.name)),
  );
}

function schemaFor(action: Connector["actions"][number], resourcePattern: string) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const field of action.fields ?? []) {
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

function descriptionFor(
  connectorName: string,
  action: Connector["actions"][number],
  resourcePattern: string,
) {
  let text = `${action.label} on ${connectorName}. ${action.description} Risk: ${action.risk}. Governed by Keel; approvals and audit apply.`;
  if (resourcePattern.trim() !== "" && resourcePattern.trim() !== "*") {
    text += ` Resource must match "${resourcePattern}".`;
  }
  return text.slice(0, 1024);
}

export function buildGatewayTools(
  catalog: Connector[],
  grants: GatewayGrant[],
  options: { connector?: string; scopes?: string[] } = {},
): GatewayTool[] {
  const bySlug = new Map(catalog.map((entry) => [entry.slug, entry]));
  const tools: GatewayTool[] = [];
  const used = new Set<string>();
  const scopes = (options.scopes ?? []).filter(Boolean);

  for (const grant of grants) {
    if (options.connector && grant.connectorSlug !== options.connector) continue;
    if (!grant.actions.length) continue;
    const connector = bySlug.get(grant.connectorSlug);
    if (!connector) continue;

    // Token scopes are action names or wildcards; filtering happens after the
    // grant is expanded so a scoped token works with a wildcard grant.
    const expanded = expandGrantActions(connector, grant.actions);
    const actions = scopes.length
      ? expanded.filter((action) => scopes.some((scope) => scope === "*" || globMatch(scope, action.name)))
      : expanded;
    if (!actions.length) continue;

    for (const action of actions) {
      const base = gatewayToolName(action.name);
      let name = base;
      let suffix = 2;
      while (used.has(name)) {
        name = `${base.slice(0, MAX_TOOL_NAME - 3)}_${suffix}`;
        suffix += 1;
      }
      used.add(name);

      const { schema, resourceKey } = schemaFor(action, grant.resourcePattern);
      tools.push({
        name,
        description: descriptionFor(connector.name, action, grant.resourcePattern),
        inputSchema: schema,
        connector: connector.slug,
        action: action.name,
        credentialId: grant.credentialId,
        resourceKey,
        resourcePattern: grant.resourcePattern,
        risk: action.risk as GatewayRisk,
      });
    }
  }

  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

export function extractGatewayInput(tool: GatewayTool, raw: Record<string, unknown>) {
  const input = { ...(raw ?? {}) };
  let resource: string | undefined;

  if (tool.resourceKey) {
    const value = input[tool.resourceKey];
    delete input[tool.resourceKey];
    if (typeof value === "string" && value.trim()) resource = value.trim();
    if (!resource) {
      throw new GatewayToolInputError(
        `${tool.name} requires a resource matching "${tool.resourcePattern}".`,
      );
    }
  } else if (!Object.prototype.hasOwnProperty.call(tool.inputSchema.properties ?? {}, "resource")) {
    const value = input.resource;
    delete input.resource;
    if (typeof value === "string" && value.trim()) resource = value.trim();
  }

  return { input, resource };
}

export function mcpToolDefinition(tool: GatewayTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.action,
      readOnlyHint: tool.risk === "read",
      destructiveHint: tool.risk === "destructive",
      openWorldHint: true,
    },
  };
}

const MAX_RESULT_BYTES = 64 * 1024;

export function mcpToolResult(value: unknown, isError = false) {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    text = JSON.stringify(value, null, 2) ?? "null";
  }
  let truncated = false;
  if (Buffer.byteLength(text, "utf8") > MAX_RESULT_BYTES) {
    text = `${Buffer.from(text, "utf8").subarray(0, MAX_RESULT_BYTES).toString("utf8")}\n… truncated at 64 KB …`;
    truncated = true;
  }
  const result: Record<string, unknown> = {
    content: [{ type: "text", text }],
    isError,
  };
  if (!truncated && value && typeof value === "object") result.structuredContent = value;
  return result;
}

export function mcpErrorResult(error: unknown) {
  if (error instanceof GatewayToolInputError) {
    return mcpToolResult({ error: { code: "invalid_input", message: error.message } }, true);
  }
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const typed = error as { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
    return mcpToolResult(
      {
        error: {
          code: String(typed.code ?? "tool_error"),
          message: String(typed.message ?? "The tool call failed."),
          details: typed.details,
          requestId: typed.requestId,
        },
      },
      true,
    );
  }
  return mcpToolResult(
    { error: { code: "tool_error", message: error instanceof Error ? error.message : String(error) } },
    true,
  );
}
