import { ApiError } from "../api";
import { isAgentType } from "../agent-types";

export const CONFIG_VERSION = 1;
export const CONFIG_LIMITS = {
  agents: 200,
  connections: 500,
  grants: 500,
  approvalPolicies: 500,
  webhooks: 100,
} as const;

export type ConfigAgent = {
  name: string;
  type?: string;
  description?: string | null;
  tags?: string[];
  autonomousMode?: boolean;
};

export type ConfigConnection = {
  name: string;
  connector: string;
  type?: string;
  metadata?: Record<string, unknown>;
};

export type ConfigGrant = {
  agent: string;
  connection: string;
  actions: string[];
  resource?: string;
  approvalMode?: string | null;
  conditions?: Record<string, unknown>;
  expiresAt?: string | null;
};

export type ConfigApprovalPolicy = {
  agent: string | null;
  actionPattern: string;
  mode: string;
  slaMinutes?: number | null;
  escalateToRole?: string | null;
};

export type ConfigWebhook = {
  url: string;
  events: string[];
};

export type ConfigV1 = {
  version: 1;
  environment: string;
  agents: ConfigAgent[];
  connections: ConfigConnection[];
  grants: ConfigGrant[];
  approvalPolicies: ConfigApprovalPolicy[];
  webhooks: ConfigWebhook[];
};

function fail(code: string, message: string): never {
  throw new ApiError(422, code, message);
}

function section<T>(raw: Record<string, unknown>, key: string, limit: number): T[] {
  const value = raw[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("invalid_config", `${key} must be an array.`);
  if (value.length > limit) fail("config_too_large", `${key} cannot contain more than ${limit} entries.`);
  return value as T[];
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail("invalid_config", `${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) fail("invalid_config", `${field} cannot be empty.`);
  if (trimmed.length > max) fail("invalid_config", `${field} must be ${max} characters or fewer.`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("invalid_config", `${field} must be a string or null.`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail("invalid_config", `${field} must be ${max} characters or fewer.`);
  return trimmed || null;
}

function stringArray(value: unknown, field: string, limit: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("invalid_config", `${field} must be an array of strings.`);
  return value
    .slice(0, limit)
    .map((entry) => {
      if (typeof entry !== "string") fail("invalid_config", `${field} must contain only strings.`);
      return entry.trim();
    })
    .filter(Boolean);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_config", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function normalizeConfig(raw: unknown): ConfigV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("invalid_config", "Send the configuration as a JSON or YAML object.");
  }
  const record = raw as Record<string, unknown>;
  if (Number(record.version) !== CONFIG_VERSION) {
    fail("unsupported_version", `Configuration version ${String(record.version ?? "")} is not supported. Use version 1.`);
  }

  const agents = section<ConfigAgent>(record, "agents", CONFIG_LIMITS.agents).map((entry, index) => {
    const item = objectValue(entry, `agents[${index}]`) as unknown as ConfigAgent;
    const name = text(item.name, `agents[${index}].name`, 60);
    if (name.length < 2) fail("invalid_config", `agents[${index}].name must be at least 2 characters.`);
    if (item.type !== undefined && !isAgentType(item.type)) {
      fail("invalid_agent_type", `agents[${index}].type must be support, sales, finance, coding, research, operations, data or other.`);
    }
    if (item.autonomousMode !== undefined && typeof item.autonomousMode !== "boolean") {
      fail("invalid_config", `agents[${index}].autonomousMode must be a boolean.`);
    }
    return {
      name,
      type: item.type,
      description: optionalText(item.description, `agents[${index}].description`, 280),
      tags: stringArray(item.tags, `agents[${index}].tags`, 12),
      autonomousMode: item.autonomousMode === true,
    };
  });

  const connections = section<ConfigConnection>(record, "connections", CONFIG_LIMITS.connections).map(
    (entry, index) => {
      const item = objectValue(entry, `connections[${index}]`) as unknown as ConfigConnection;
      return {
        name: text(item.name, `connections[${index}].name`, 80),
        connector: text(item.connector, `connections[${index}].connector`, 80),
        type: item.type === undefined ? undefined : text(item.type, `connections[${index}].type`, 40),
        metadata: objectValue(item.metadata, `connections[${index}].metadata`),
      };
    },
  );

  const grants = section<ConfigGrant>(record, "grants", CONFIG_LIMITS.grants).map((entry, index) => {
    const item = objectValue(entry, `grants[${index}]`) as unknown as ConfigGrant;
    const approvalMode =
      item.approvalMode === undefined || item.approvalMode === null
        ? null
        : text(item.approvalMode, `grants[${index}].approvalMode`, 40);
    let expiresAt: string | null = null;
    if (item.expiresAt !== undefined && item.expiresAt !== null) {
      const parsed = new Date(String(item.expiresAt));
      if (Number.isNaN(parsed.getTime())) {
        fail("invalid_config", `grants[${index}].expiresAt must be an ISO date or null.`);
      }
      expiresAt = parsed.toISOString();
    }
    return {
      agent: text(item.agent, `grants[${index}].agent`, 60),
      connection: text(item.connection, `grants[${index}].connection`, 80),
      actions: stringArray(item.actions, `grants[${index}].actions`, 50),
      resource: item.resource === undefined ? "*" : text(item.resource, `grants[${index}].resource`, 200),
      approvalMode,
      conditions: objectValue(item.conditions, `grants[${index}].conditions`),
      expiresAt,
    };
  });

  const approvalPolicies = section<ConfigApprovalPolicy>(
    record,
    "approvalPolicies",
    CONFIG_LIMITS.approvalPolicies,
  ).map((entry, index) => {
    const item = objectValue(entry, `approvalPolicies[${index}]`) as unknown as ConfigApprovalPolicy;
    return {
      agent:
        item.agent === undefined || item.agent === null
          ? null
          : text(item.agent, `approvalPolicies[${index}].agent`, 60),
      actionPattern: text(item.actionPattern, `approvalPolicies[${index}].actionPattern`, 200),
      mode: text(item.mode, `approvalPolicies[${index}].mode`, 40),
      slaMinutes:
        item.slaMinutes === undefined || item.slaMinutes === null ? null : Number(item.slaMinutes),
      escalateToRole:
        item.escalateToRole === undefined || item.escalateToRole === null
          ? null
          : String(item.escalateToRole),
    };
  });

  const webhooks = section<ConfigWebhook>(record, "webhooks", CONFIG_LIMITS.webhooks).map((entry, index) => {
    const item = objectValue(entry, `webhooks[${index}]`) as unknown as ConfigWebhook;
    return {
      url: text(item.url, `webhooks[${index}].url`, 500),
      events: stringArray(item.events, `webhooks[${index}].events`, 40),
    };
  });

  return {
    version: CONFIG_VERSION,
    environment: typeof record.environment === "string" ? record.environment.trim() : "",
    agents,
    connections,
    grants,
    approvalPolicies,
    webhooks,
  };
}
