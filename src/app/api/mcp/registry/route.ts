import { NextResponse } from "next/server";
import { CONNECTORS } from "@/lib/connectors";
import {
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
} from "@/lib/mcp-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function originFor(req: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const origin = originFor(req);
  const manifest = {
    name: "dev.authab/gateway",
    title: MCP_SERVER_INFO.title,
    description:
      "Authab's hosted MCP gateway exposes exactly the connector actions an agent has been granted, executes them through Authab's policy, approval and audit pipeline, and never hands provider credentials to the client.",
    version: MCP_SERVER_INFO.version,
    protocolVersion: MCP_PROTOCOL_VERSION,
    protocolVersions: [...MCP_PROTOCOL_VERSIONS],
    transport: {
      type: "streamable-http",
      url: `${origin}/api/mcp`,
      contentType: "application/json",
      sse: false,
      note: "Stateless: send JSON-RPC over POST and include the agent token as a Bearer credential on every request.",
    },
    remotes: [
      {
        type: "streamable-http",
        url: `${origin}/api/mcp`,
        headers: [
          { name: "Authorization", value: "Bearer {agent_token}", isRequired: true },
        ],
      },
    ],
    authentication: {
      type: "bearer",
      scheme: "Bearer",
      tokenType: "agent_token",
      tokenEndpoint: `${origin}/api/v1/agents/{agentId}/token`,
      tokenTtlSeconds: { min: 60, max: 3600 },
      note: "Mint a short-lived agent token with a secret API key. The token carries the agent's scopes; tools/list only returns actions the agent may call.",
    },
    capabilities: { tools: { listChanged: false } },
    serverInfo: MCP_SERVER_INFO,
    instructions:
      "Call initialize, then tools/list. Every tools/call is evaluated by Authab policy and recorded in the audit log; destructive or financial actions may return a pending_approval result with an approvalUrl.",
    docs: {
      mcp: `${origin}/docs/mcp`,
      connectors: `${origin}/docs/connectors`,
      api: `${origin}/docs/api`,
    },
    limits: { toolResultBytes: 65536, toolNameMaxLength: 64 },
    connectors: CONNECTORS.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      category: entry.category,
      status: entry.status,
      version: entry.version,
      description: entry.description,
      resourceLabel: entry.resourceLabel,
      actions: entry.actions.map((action) => ({
        name: action.name,
        label: action.label,
        risk: action.risk,
      })),
    })),
  };

  return NextResponse.json(manifest, {
    headers: {
      ...CORS,
      "cache-control": "public, max-age=300, s-maxage=300",
      "x-authab-mcp-protocol": MCP_PROTOCOL_VERSION,
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
