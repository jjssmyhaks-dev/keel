import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "zapier";
const action = actionFactory(slug);

const zapier: Connector = {
  slug,
  name: "Zapier",
  category: "Developer",
  description: "Trigger Zaps through a catch hook or call a curated Zapier MCP server.",
  color: "#FF4A00",
  mark: "ZP",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "api_key", label: "Catch hook URL" },
    { type: "bearer", label: "Zapier MCP token" },
  ],
  defaultAuth: "api_key",
  hosts: ["hooks.zapier.com", "mcp.zapier.com"],
  allowAnyPublicHost: false,
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
  credentialFields: [
    {
      key: "hook_url",
      label: "Catch hook URL",
      secret: true,
      placeholder: "https://hooks.zapier.com/hooks/catch/…",
      help: "Mode A. The URL embeds the key, so it is stored and redacted as a secret.",
    },
    {
      key: "mcp_url",
      label: "MCP server URL",
      placeholder: "https://mcp.zapier.com/api/mcp/…",
      help: "Mode B. Paste the endpoint of the Zapier MCP server you created.",
    },
    {
      key: "token",
      label: "MCP access token",
      secret: true,
      placeholder: "mcp_…",
      help: "Mode B only. Sent as a Bearer token to the MCP server.",
    },
  ],
  requireAnyFields: ["hook_url", "mcp_url"],
  scopes: [
    { value: "hook", label: "Trigger a Zap through a catch hook" },
    { value: "mcp", label: "List and call tools exposed by a Zapier MCP server", optional: true },
  ],
  resourceLabel: "Zap or MCP tool",
  resourcePlaceholder: "lead-router",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["hook_url", "token", "authorization", "body"],
  actions: [
    action("trigger_hook", "Trigger hook", "POST", "", "write", "POST a JSON payload to the catch hook. The effects cannot be undone from here.", {
      baseUrlField: "hook_url",
      resourceLabel: "Zap",
      fields: [{ key: "payload", label: "JSON payload", placeholder: '{"email":"lead@acme.dev"}', required: true }],
      mock: { status: "success", attempt: "1a2b3c" },
    }),
    action("list_mcp_tools", "List MCP tools", "POST", "", "read", "List the tools the Zapier MCP server exposes.", {
      baseUrlField: "mcp_url",
      resourceLabel: "MCP server",
      fields: [{ key: "method", label: "JSON-RPC method", placeholder: "tools/list" }],
      mock: { jsonrpc: "2.0", result: { tools: [{ name: "create_spreadsheet_row" }, { name: "send_slack_message" }] } },
    }),
    action("call_mcp_tool", "Call MCP tool", "POST", "", "write", "Call one tool by name. Unknown tools are treated as write and require approval in production.", {
      baseUrlField: "mcp_url",
      resourceLabel: "MCP tool",
      fields: [
        { key: "name", label: "Tool name", placeholder: "create_spreadsheet_row", required: true },
        { key: "arguments", label: "Arguments", placeholder: '{"row":{"email":"lead@acme.dev"}}' },
      ],
      mock: { jsonrpc: "2.0", result: { content: [{ type: "text", text: "Row created" }] } },
    }),
  ],
};

export default zapier;
