import { randomUUID } from "node:crypto";
import { db } from "./db";
import { CONNECTORS } from "./connectors";
import type { AgentAuthContext } from "./api";
import {
  buildGatewayTools,
  extractGatewayInput,
  mcpErrorResult,
  mcpToolResult,
  type GatewayGrant,
  type GatewayTool,
} from "./mcp-tools";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
export const MCP_SERVER_INFO = { name: "keel", title: "Keel MCP Gateway", version: "1.0.0" };

export interface GatewayProxyCall {
  authorization: string;
  connector: string;
  action: string;
  resource?: string;
  input: Record<string, unknown>;
  credentialId?: string;
  idempotencyKey: string;
}

export interface GatewayProxyResponse {
  status: number;
  payload: unknown;
}

export type ProxyInvoker = (call: GatewayProxyCall) => Promise<GatewayProxyResponse>;

export async function invokeProxyRoute(call: GatewayProxyCall): Promise<GatewayProxyResponse> {
  // Reuse the public proxy route so policy, approvals, audit, limits and
  // provider execution behave identically for MCP and direct API callers.
  const { POST } = await import("@/app/api/v1/proxy/[connector]/route");
  const request = new Request(
    `http://keel.internal/api/v1/proxy/${encodeURIComponent(call.connector)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: call.authorization,
        "idempotency-key": call.idempotencyKey,
      },
      body: JSON.stringify({
        action: call.action,
        resource: call.resource,
        input: call.input,
        credentialId: call.credentialId,
      }),
    },
  );
  const response = await POST(request, {
    params: Promise.resolve({ connector: call.connector }),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

export async function loadGatewayGrants(
  agentId: string,
  environmentId: string,
): Promise<GatewayGrant[]> {
  const grants = await db.grant.findMany({
    where: {
      agentId,
      environmentId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      credential: { revokedAt: null, status: { not: "revoked" } },
    },
    include: { credential: true },
    orderBy: { createdAt: "asc" },
  });

  return grants.map((grant) => {
    let actions: string[] = [];
    try {
      const parsed = JSON.parse(grant.actionsJson || "[]");
      if (Array.isArray(parsed)) actions = parsed.filter((entry): entry is string => typeof entry === "string");
    } catch {
      actions = [];
    }
    return {
      credentialId: grant.credentialId,
      actions,
      resourcePattern: grant.resourcePattern || "*",
      connectorSlug: grant.credential.connectorSlug,
      credentialName: grant.credential.name,
    };
  });
}

export function tokenScopes(auth: AgentAuthContext) {
  const scopes = auth.claims.scopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

export async function gatewayTools(
  auth: AgentAuthContext,
  options: { connector?: string } = {},
): Promise<GatewayTool[]> {
  const grants = await loadGatewayGrants(auth.agent.id, auth.environment.id);
  return buildGatewayTools(CONNECTORS, grants, { ...options, scopes: tokenScopes(auth) });
}

export interface GatewayExecution {
  tool: GatewayTool;
  arguments: Record<string, unknown>;
  authorization: string;
  idempotencyKey?: string;
  invoke?: ProxyInvoker;
}

export async function executeGatewayTool(execution: GatewayExecution) {
  try {
    const { input, resource } = extractGatewayInput(execution.tool, execution.arguments);
    const invoke = execution.invoke ?? invokeProxyRoute;
    const response = await invoke({
      authorization: execution.authorization,
      connector: execution.tool.connector,
      action: execution.tool.action,
      resource,
      input,
      credentialId: execution.tool.credentialId,
      idempotencyKey: execution.idempotencyKey ?? `mcp_${randomUUID()}`,
    });
    return proxyResponseToToolResult(response);
  } catch (error) {
    return mcpErrorResult(error);
  }
}

export function proxyResponseToToolResult(response: GatewayProxyResponse) {
  const payload = response.payload;
  const failed =
    response.status >= 400 ||
    (payload !== null && typeof payload === "object" && "error" in payload);
  if (failed) {
    const error = payload !== null && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
    return mcpErrorResult(error ?? new Error(`The Keel proxy call failed with HTTP ${response.status}.`));
  }
  return mcpToolResult(payload);
}
