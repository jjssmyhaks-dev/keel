import { Authab, AuthabError } from "@authab/sdk";
import type { Connector } from "@authab/sdk";

const MAX_RESULT_BYTES = 64 * 1024;
const TOKEN_TTL_SECONDS = 600;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "authab_whoami",
    description:
      "Show the configured Authab agent, its environment, project, organisation and granted scopes. Use this first to confirm which identity the tools run as.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "authab_list_connections",
    description:
      "List the connections (credential + connector) this agent may reach, with masked hints, granted actions and approval mode. A connection not in this list cannot be called.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "authab_list_actions",
    description:
      "List the actions this agent is granted, per connection, with risk levels. Optional connector filter (for example slack).",
    inputSchema: {
      type: "object",
      properties: {
        connector: { type: "string", description: "Optional connector slug to filter, e.g. slack." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "authab_call",
    description:
      "Make a governed connector call through Authab. Policy, grants, rate limits, approvals and audit apply exactly as for any agent. Returns status executed or pending_approval. Policy denials are errors with a code.",
    inputSchema: {
      type: "object",
      properties: {
        connector: { type: "string", description: "Connector slug, e.g. slack." },
        action: { type: "string", description: "Exact action name, e.g. slack.post_message." },
        resource: { type: "string", description: "Optional resource the action applies to, e.g. #research-launch." },
        input: {
          type: "object",
          description: "Action input fields, e.g. { channel, text }.",
          additionalProperties: true,
        },
        credentialId: { type: "string", description: "Optional connection id when more than one exists." },
        idempotencyKey: { type: "string", description: "Optional stable key to make retries safe." },
      },
      required: ["connector", "action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "authab_pending_approvals",
    description:
      "List this agent's pending approval requests. Approvals are decided by a human in the Authab dashboard or approval link; no MCP tool can approve them.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "authab_approval_status",
    description:
      "Read the current status and execution result of one approval request belonging to this agent.",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string", description: "Approval id, e.g. apr_..." } },
      required: ["approvalId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "authab_search_audit",
    description:
      "Search recent audit events for this agent, newest first. Filter by action prefix (e.g. proxy.call) or outcome (executed, denied, recorded).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action prefix, e.g. proxy.call or approval." },
        outcome: { type: "string", description: "Outcome filter, e.g. allowed, denied, recorded." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export class ToolInputError extends Error {}

export class AuthabTools {
  private readonly authab: Authab;
  private readonly agentId: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(options: { apiKey: string; agentId: string; baseUrl?: string }) {
    this.authab = new Authab({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    this.agentId = options.agentId;
  }

  async handle(name: string, rawArgs: Record<string, unknown> | undefined) {
    const args = rawArgs ?? {};
    switch (name) {
      case "authab_whoami":
        return this.whoami();
      case "authab_list_connections":
        return this.listConnections();
      case "authab_list_actions":
        return this.listActions(args);
      case "authab_call":
        return this.call(args);
      case "authab_pending_approvals":
        return this.pendingApprovals();
      case "authab_approval_status":
        return this.approvalStatus(args);
      case "authab_search_audit":
        return this.searchAudit(args);
      default:
        throw new ToolInputError(`Unknown tool “${name}”.`);
    }
  }

  private async whoami() {
    const [me, agent] = await Promise.all([this.authab.me(), this.authab.agents.get(this.agentId)]);
    const scopes = [...new Set((agent.grants ?? []).flatMap((grant) => grant.actions))];
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        keyMode: agent.keyMode,
        framework: agent.framework,
        tags: agent.tags,
        fingerprint: agent.fingerprint,
      },
      environment: me.environment,
      project: me.project,
      organization: me.organization,
      scopes,
    };
  }

  private async listConnections() {
    const grants = await this.authab.grants.list({ agent: this.agentId });
    const connections = await Promise.all(
      grants.data.map(async (grant) => {
        const metadata = await this.authab.vault.get(grant.credentialId).catch(() => null);
        return {
          grantId: grant.id,
          credentialId: grant.credentialId,
          name: metadata?.name ?? grant.credential?.name ?? grant.credentialId,
          connector: metadata?.connector ?? grant.credential?.connectorSlug ?? null,
          status: metadata?.status ?? grant.credential?.status ?? "unknown",
          hint: metadata?.maskedHint ?? null,
          actions: grant.actions,
          resourcePattern: grant.resourcePattern,
          approvalMode: grant.approvalMode,
          expiresAt: grant.expiresAt,
        };
      }),
    );
    return { agentId: this.agentId, connections };
  }

  private async listActions(args: Record<string, unknown>) {
    const filter = optionalString(args, "connector");
    const [grants, catalog] = await Promise.all([
      this.authab.grants.list({ agent: this.agentId }),
      this.authab.connectors.list(),
    ]);
    const bySlug = new Map(catalog.data.map((connector) => [connector.slug, connector]));

    const connections = [];
    for (const grant of grants.data) {
      const connector = bySlug.get(grant.credential?.connectorSlug ?? "");
      if (!connector) continue;
      if (filter && connector.slug !== filter) continue;
      connections.push({
        connector: connector.slug,
        connectorName: connector.name,
        credentialId: grant.credentialId,
        actions: expandActions(connector, grant.actions),
      });
    }
    return { agentId: this.agentId, connections };
  }

  private async call(args: Record<string, unknown>) {
    const connector = requiredString(args, "connector");
    const action = requiredString(args, "action");
    if (!action.startsWith(`${connector}.`)) {
      throw new ToolInputError(`Action “${action}” does not belong to connector “${connector}”.`);
    }
    const input = args.input === undefined ? {} : args.input;
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ToolInputError("input must be a JSON object.");
    }

    const token = await this.agentToken();
    const result = await this.authab.proxy.call({
      token,
      connector,
      action,
      resource: optionalString(args, "resource"),
      credentialId: optionalString(args, "credentialId"),
      idempotencyKey: optionalString(args, "idempotencyKey"),
      input: input as Record<string, unknown>,
    });

    if (result.status === "pending_approval") {
      return {
        ...result,
        hint: "A human must approve this request in the Authab dashboard. Use authab_approval_status to check later.",
      };
    }
    return result;
  }

  private async pendingApprovals() {
    const listed = await this.authab.approvals.list({ agentId: this.agentId, status: "pending" });
    return {
      agentId: this.agentId,
      approvals: listed.data.map((approval) => ({
        id: approval.id,
        action: approval.action,
        summary: approval.summary,
        risk: approval.risk,
        status: approval.status,
        expiresAt: approval.expiresAt,
        createdAt: approval.createdAt,
      })),
    };
  }

  private async approvalStatus(args: Record<string, unknown>) {
    const approvalId = requiredString(args, "approvalId");
    const approval = await this.authab.approvals.get(approvalId);
    if (approval.agentId !== this.agentId) {
      throw new ToolInputError("That approval belongs to a different agent. This server cannot read it.");
    }
    return {
      id: approval.id,
      action: approval.action,
      status: approval.status,
      risk: approval.risk,
      summary: approval.summary,
      decidedBy: approval.decidedBy,
      decidedAt: approval.decidedAt,
      decisionNote: approval.decisionNote,
      expiresAt: approval.expiresAt,
      executionResult: approval.executionResult,
    };
  }

  private async searchAudit(args: Record<string, unknown>) {
    const limit = optionalNumber(args, "limit") ?? 20;
    const page = await this.authab.audit.list({
      agent: this.agentId,
      action: optionalString(args, "action"),
      outcome: optionalString(args, "outcome"),
      limit: Math.max(1, Math.min(Math.trunc(limit), 100)),
      order: "desc",
    });
    return {
      agentId: this.agentId,
      hasMore: page.pageInfo.hasMore,
      nextCursor: page.pageInfo.nextCursor,
      events: page.data.map((event) => ({
        seq: event.seq,
        timestamp: event.timestamp,
        action: event.action,
        outcome: event.outcome,
        requestId: event.requestId,
        resource: event.resource,
        payload: event.payload,
        hash: event.hash,
      })),
    };
  }

  private async agentToken() {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }
    const issued = await this.authab.agents.token(this.agentId, { ttl: TOKEN_TTL_SECONDS });
    this.cachedToken = { token: issued.accessToken, expiresAt: new Date(issued.expiresAt).getTime() };
    return issued.accessToken;
  }
}

export function toolResult(value: unknown, isError = false) {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    text = JSON.stringify(value, null, 2);
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_RESULT_BYTES) {
    text = `${Buffer.from(text, "utf8").subarray(0, MAX_RESULT_BYTES).toString("utf8")}\n… truncated at 64 KB …`;
  }
  const result: Record<string, unknown> = {
    content: [{ type: "text", text }],
    isError,
  };
  if (!isError && value && typeof value === "object") result.structuredContent = value;
  return result;
}

export function errorResult(error: unknown) {
  if (error instanceof AuthabError) {
    return toolResult(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: error.requestId,
        },
      },
      true,
    );
  }
  if (error instanceof ToolInputError) return toolResult({ error: { code: "invalid_input", message: error.message } }, true);
  const message = error instanceof Error ? error.message : String(error);
  return toolResult({ error: { code: "internal_error", message } }, true);
}

function expandActions(connector: Connector, patterns: string[]) {
  if (patterns.includes("*")) {
    return connector.actions.map(actionView);
  }
  const risks = new Set<string>();
  const exact = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("risk:")) risks.add(pattern.slice(5));
    else if (["read", "write", "destructive", "financial"].includes(pattern)) risks.add(pattern);
    else exact.add(pattern);
  }
  return connector.actions
    .filter((action) => exact.has(action.name) || risks.has(action.risk))
    .map(actionView);
}

function actionView(action: Connector["actions"][number]) {
  return {
    name: action.name,
    label: action.label,
    description: action.description,
    risk: action.risk,
    fields: action.fields?.map((field) => field.key) ?? [],
  };
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`${key} is required.`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolInputError(`${key} must be a string.`);
  return value.trim() || undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ToolInputError(`${key} must be a number.`);
  return number;
}
