import { createInterface } from "node:readline";
import { AuthabTools, TOOLS, errorResult, toolResult } from "./tools";

const VERSION = "1.0.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function log(message: string) {
  process.stderr.write(`[authab-mcp] ${message}\n`);
}

const apiKey = process.env.AUTHAB_API_KEY?.trim();
const agentId = process.env.AUTHAB_AGENT_ID?.trim();

if (!apiKey) {
  log("AUTHAB_API_KEY is required. Create a secret key in the Authab dashboard.");
  process.exit(1);
}
if (!agentId) {
  log("AUTHAB_AGENT_ID is required. It scopes the tools to one agent's grants.");
  process.exit(1);
}

const baseUrl = process.env.AUTHAB_BASE_URL?.trim() || undefined;
const tools = new AuthabTools({ apiKey, agentId, baseUrl });
log(`serving agent ${agentId} via ${baseUrl ?? "https://api.authab.dev/v1"} over stdio`);

function send(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: string | number | null | undefined, result: unknown) {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function sendError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message, data } });
}

async function handle(request: JsonRpcRequest) {
  const { method, id } = request;
  if (!method) {
    if (id !== undefined) sendError(id, -32600, "Invalid request: method is required.");
    return;
  }

  switch (method) {
    case "initialize": {
      const requested = request.params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && requested.length > 0 ? requested : DEFAULT_PROTOCOL_VERSION;
      const client = request.params?.clientInfo as { name?: string; version?: string } | undefined;
      if (client?.name) log(`client ${client.name}${client.version ? ` ${client.version}` : ""} connected`);
      sendResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "authab", title: "Authab", version: VERSION },
        instructions:
          "Authab governs this agent's connector calls. Start with authab_whoami, then authab_list_connections. Use authab_call for actions; a 202 means a human must approve before execution. No tool can approve its own request.",
      });
      return;
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      if (id !== undefined) sendResult(id, {});
      return;
    case "tools/list":
      sendResult(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const known = TOOLS.some((tool) => tool.name === name);
      if (!known) {
        sendError(id, -32602, `Unknown tool “${name}”.`);
        return;
      }
      const args =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const value = await tools.handle(name, args);
        sendResult(id, toolResult(value));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`tool ${name} failed: ${message}`);
        sendResult(id, errorResult(error));
      }
      return;
    }
    default:
      if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
  }
}

function processLine(line: string) {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    sendError(null, -32700, "Parse error: the line is not valid JSON.");
    return;
  }
  if (!request || typeof request !== "object") {
    sendError(null, -32600, "Invalid request.");
    return;
  }
  // Notifications omit id; they never receive a response.
  if (!("id" in request)) {
    void handle(request).catch((error) => log(`notification failed: ${String(error)}`));
    return;
  }
  return handle(request);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue: Promise<unknown> = Promise.resolve();

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue = queue.then(() => processLine(trimmed)).catch((error) => {
    log(`unhandled error: ${error instanceof Error ? error.message : String(error)}`);
  });
});

input.on("close", () => {
  queue.finally(() => {
    log("stdin closed, shutting down");
    process.exit(0);
  });
});

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  log(`stdout error: ${error.message}`);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
