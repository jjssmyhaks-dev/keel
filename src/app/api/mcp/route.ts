import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, authenticateAgent } from "@/lib/api";
import {
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
  executeGatewayTool,
  gatewayTools,
} from "@/lib/mcp-gateway";
import { mcpToolDefinition } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: Record<string, unknown>;
}

const INSTRUCTIONS = [
  "Tools are the connector actions granted to your agent in Keel. Every call is",
  "checked against grants, policies and token scopes, then written to the audit log.",
  "A call may return status \"pending_approval\" with an approvalUrl; a human must",
  "approve it before the provider action runs. Never retry a denied or pending call",
  "with a different tool to work around governance.",
].join(" ");

function rpcResult(id: JsonRpcId, result: unknown, headers?: Record<string, string>) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: { "cache-control": "no-store", ...(headers ?? {}) } },
  );
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function accepted() {
  return new NextResponse(null, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error: the request body is not valid JSON.", undefined, 400);
  }

  if (Array.isArray(body)) {
    return rpcError(null, -32600, "Batch requests are not supported by this MCP endpoint.", undefined, 400);
  }
  if (!body || typeof body !== "object") {
    return rpcError(null, -32600, "Invalid request: expected a JSON-RPC object.", undefined, 400);
  }

  const request = body as JsonRpcRequest;
  const id = request.id === undefined ? null : request.id;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method) {
    return rpcError(id, -32600, "Invalid request: jsonrpc must be \"2.0\" and method is required.", undefined, 400);
  }
  if (id !== null && typeof id !== "string" && typeof id !== "number") {
    return rpcError(null, -32600, "Invalid request: id must be a string, number or null.", undefined, 400);
  }

  const protocolHeader = req.headers.get("mcp-protocol-version");
  if (protocolHeader && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) {
    return rpcError(
      id,
      -32600,
      `Unsupported MCP protocol version "${protocolHeader}". Supported: ${MCP_PROTOCOL_VERSIONS.join(", ")}.`,
      undefined,
      400,
    );
  }

  let auth;
  try {
    auth = await authenticateAgent(req);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal_error";
    const message = error instanceof ApiError ? error.message : "Could not authenticate the agent token.";
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32001,
          message: `Unauthorized: ${message}`,
          data: { keelCode: code, status },
        },
      },
      {
        status: status === 500 ? 500 : status,
        headers: {
          "cache-control": "no-store",
          ...(status === 401 ? { "www-authenticate": "Bearer realm=\"keel\"" } : {}),
        },
      },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  const params = request.params ?? {};

  if (request.method.startsWith("notifications/")) {
    return accepted();
  }

  switch (request.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const negotiated = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
      return rpcResult(
        id,
        {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
        { "mcp-session-id": `mcp_${randomUUID()}` },
      );
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list": {
      const tools = await gatewayTools(auth);
      return rpcResult(id, { tools: tools.map(mcpToolDefinition) });
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!name) {
        return rpcError(id, -32602, "Invalid params: tools/call requires a tool name.");
      }
      const args = params.arguments;
      if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
        return rpcError(id, -32602, "Invalid params: arguments must be an object.");
      }

      const tools = await gatewayTools(auth);
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) {
        return rpcError(
          id,
          -32602,
          `Unknown tool "${name}". Call tools/list to see the actions granted to this agent.`,
          { availableTools: tools.map((entry) => entry.name) },
        );
      }

      const result = await executeGatewayTool({
        tool,
        arguments: (args as Record<string, unknown> | undefined) ?? {},
        authorization,
      });
      return rpcResult(id, result);
    }

    default:
      return rpcError(id, -32601, `Method not found: ${request.method}`);
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: "method_not_allowed",
        message:
          "This MCP endpoint uses Streamable HTTP (POST JSON-RPC) and does not offer an SSE stream. See /api/mcp/registry for server metadata.",
      },
    },
    { status: 405, headers: { allow: "POST", "cache-control": "no-store" } },
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: {
        code: "method_not_allowed",
        message: "This MCP endpoint is stateless; there is no session to terminate.",
      },
    },
    { status: 405, headers: { allow: "POST", "cache-control": "no-store" } },
  );
}
