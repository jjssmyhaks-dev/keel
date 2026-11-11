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

interface RpcReply {
  body: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
}

interface RpcContext {
  authorization: string;
  tools: Promise<Awaited<ReturnType<typeof gatewayTools>>>;
}

const INSTRUCTIONS = [
  "Tools are the connector actions granted to your agent in Authab. Every call is",
  "checked against grants, policies and token scopes, then written to the audit log.",
  "A call may return status \"pending_approval\" with an approvalUrl; a human must",
  "approve it before the provider action runs. Never retry a denied or pending call",
  "with a different tool to work around governance.",
].join(" ");

const MAX_BATCH_SIZE = 20;

function okReply(id: JsonRpcId, result: unknown, headers?: Record<string, string>): RpcReply {
  return { body: { jsonrpc: "2.0", id, result }, status: 200, headers };
}

function errorReply(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  status = 200,
): RpcReply {
  return {
    body: { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    status,
  };
}

function jsonResponse(reply: RpcReply) {
  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { "cache-control": "no-store", ...(reply.headers ?? {}) },
  });
}

function accepted() {
  return new NextResponse(null, { status: 202, headers: { "cache-control": "no-store" } });
}

function authFailure(error: unknown, id: JsonRpcId = null) {
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
        data: { authabCode: code, status },
      },
    },
    {
      status: status === 500 ? 500 : status,
      headers: {
        "cache-control": "no-store",
        ...(status === 401 ? { "www-authenticate": "Bearer realm=\"authab\"" } : {}),
      },
    },
  );
}

async function dispatchRpc(request: JsonRpcRequest, ctx: RpcContext, batch = false): Promise<RpcReply | null> {
  const id = request.id === undefined ? null : request.id;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method) {
    return errorReply(id, -32600, "Invalid request: jsonrpc must be \"2.0\" and method is required.", undefined, 400);
  }
  if (id !== null && typeof id !== "string" && typeof id !== "number") {
    return errorReply(null, -32600, "Invalid request: id must be a string, number or null.", undefined, 400);
  }

  if (request.method.startsWith("notifications/")) return null;

  const params = request.params ?? {};
  switch (request.method) {
    case "initialize": {
      if (batch) {
        return errorReply(id, -32600, "initialize must be sent on its own, not inside a batch.");
      }
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const negotiated = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
      return okReply(
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
      return okReply(id, {});

    case "tools/list": {
      const tools = await ctx.tools;
      return okReply(id, { tools: tools.map(mcpToolDefinition) });
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!name) {
        return errorReply(id, -32602, "Invalid params: tools/call requires a tool name.");
      }
      const args = params.arguments;
      if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
        return errorReply(id, -32602, "Invalid params: arguments must be an object.");
      }

      const tools = await ctx.tools;
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) {
        return errorReply(
          id,
          -32602,
          `Unknown tool "${name}". Call tools/list to see the actions granted to this agent.`,
          { availableTools: tools.map((entry) => entry.name) },
        );
      }

      const result = await executeGatewayTool({
        tool,
        arguments: (args as Record<string, unknown> | undefined) ?? {},
        authorization: ctx.authorization,
      });
      return okReply(id, result);
    }

    default:
      return errorReply(id, -32601, `Method not found: ${request.method}`);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(errorReply(null, -32700, "Parse error: the request body is not valid JSON.", undefined, 400));
  }

  if (!body || (typeof body !== "object" && !Array.isArray(body))) {
    return jsonResponse(errorReply(null, -32600, "Invalid request: expected a JSON-RPC object.", undefined, 400));
  }

  const protocolHeader = req.headers.get("mcp-protocol-version");
  if (protocolHeader && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) {
    return jsonResponse(
      errorReply(
        null,
        -32600,
        `Unsupported MCP protocol version "${protocolHeader}". Supported: ${MCP_PROTOCOL_VERSIONS.join(", ")}.`,
        undefined,
        400,
      ),
    );
  }

  const batch = Array.isArray(body) ? (body as unknown[]) : null;
  if (batch) {
    if (batch.length === 0) {
      return jsonResponse(errorReply(null, -32600, "Invalid request: an empty batch is not valid.", undefined, 400));
    }
    if (protocolHeader === MCP_PROTOCOL_VERSION) {
      return jsonResponse(
        errorReply(
          null,
          -32600,
          `Batch requests were removed in MCP protocol version ${MCP_PROTOCOL_VERSION}. Send individual requests.`,
          undefined,
          400,
        ),
      );
    }
    if (batch.length > MAX_BATCH_SIZE) {
      return jsonResponse(
        errorReply(null, -32600, `Batch requests are limited to ${MAX_BATCH_SIZE} entries.`, undefined, 400),
      );
    }
  }

  let auth: Awaited<ReturnType<typeof authenticateAgent>>;
  try {
    auth = await authenticateAgent(req);
  } catch (error) {
    return authFailure(error);
  }

  const ctx: RpcContext = {
    authorization: req.headers.get("authorization") ?? "",
    tools: gatewayTools(auth),
  };

  if (batch) {
    const replies: Record<string, unknown>[] = [];
    for (const entry of batch) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        replies.push(errorReply(null, -32600, "Invalid request: expected a JSON-RPC object.").body);
        continue;
      }
      const reply = await dispatchRpc(entry as JsonRpcRequest, ctx, true);
      if (reply) replies.push(reply.body);
    }
    if (!replies.length) return accepted();
    return NextResponse.json(replies, { status: 200, headers: { "cache-control": "no-store" } });
  }

  const reply = await dispatchRpc(body as JsonRpcRequest, ctx);
  return reply ? jsonResponse(reply) : accepted();
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
