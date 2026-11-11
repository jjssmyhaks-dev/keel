import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "MCP server and gateway",
  description: "Expose Authab-governed tools to Claude, Cursor and hosted MCP clients over stdio or Streamable HTTP.",
};

export default function McpPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="MCP server and gateway"
      intro="Give an MCP host — Claude Desktop, Cursor, a hosted agent platform — a governed set of tools backed by Authab. Use the stdio server for local hosts or the hosted gateway for remote clients. Either way, every tool call becomes a proxy call with the agent's identity, policy and audit, not a raw provider token in the host's environment."
      updated="11 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#why", name: "Why route through Authab" },
            { href: "#run", name: "Run the stdio server" },
            { href: "#clients", name: "Client configuration" },
            { href: "#tools", name: "Tools" },
            { href: "#gateway", name: "Hosted gateway" },
            { href: "#registry", name: "Registry manifest" },
            { href: "#policy", name: "Policy and approvals" },
            { href: "#limits", name: "Limits" },
          ]}
        />
      }
    >
      <h2 id="why">Why route through Authab</h2>
      <p>
        Most MCP servers hand the host a provider API key and let it call anything the key can reach. Authab instead
        binds the session to one agent. The host sees only the tools the agent has grants for, and every call is
        evaluated and recorded. Revoking the agent turns every tool off at once.
      </p>

      <h2 id="run">Run the stdio server</h2>
      <p>The npm package ships in the Authab repository; registry publication is pending the public launch.</p>
      <pre>{`git clone https://github.com/jjssmyhaks-dev/keel.git authab
cd authab && npm ci && npm run mcp:build

# environment
AUTHAB_API_KEY=sk_dev_...          # server-side secret key
AUTHAB_AGENT_ID=agt_atlas          # the agent whose grants shape the tool list
AUTHAB_BASE_URL=https://api.authab.dev/v1   # optional
node mcp/dist/server.js`}</pre>
      <p>
        The server mints a short-lived token for <code>AUTHAB_AGENT_ID</code> on demand and refreshes it before expiry. If
        the agent is paused or killed, tool calls fail with the same <code>agent_inactive</code> error the proxy
        returns.
      </p>

      <h2 id="clients">Client configuration</h2>
      <p>Claude Desktop (<code>claude_desktop_config.json</code>):</p>
      <pre>{`{
  "mcpServers": {
    "authab": {
      "command": "node",
      "args": ["/absolute/path/to/authab/mcp/dist/server.js"],
      "env": {
        "AUTHAB_API_KEY": "sk_dev_...",
        "AUTHAB_AGENT_ID": "agt_atlas"
      }
    }
  }
}`}</pre>
      <p>Cursor (<code>.cursor/mcp.json</code>):</p>
      <pre>{`{
  "mcpServers": {
    "authab": {
      "command": "node",
      "args": ["/absolute/path/to/authab/mcp/dist/server.js"],
      "env": {
        "AUTHAB_API_KEY": "sk_dev_...",
        "AUTHAB_AGENT_ID": "agt_atlas"
      }
    }
  }
}`}</pre>

      <h2 id="tools">Tools</h2>
      <table>
        <thead>
          <tr><th>Tool</th><th>Type</th><th>What it does</th></tr>
        </thead>
        <tbody>
          <tr><td><code>authab_whoami</code></td><td>read</td><td>Agent, environment and granted scopes.</td></tr>
          <tr><td><code>authab_list_connections</code></td><td>read</td><td>Connections the agent can reach, with masked hints.</td></tr>
          <tr><td><code>authab_list_actions</code></td><td>read</td><td>Actions available per connection, as granted.</td></tr>
          <tr><td><code>authab_call</code></td><td>governed write</td><td>Proxied connector call: connector, action, resource, input.</td></tr>
          <tr><td><code>authab_pending_approvals</code></td><td>read</td><td>The agent&apos;s pending requests and their ids.</td></tr>
          <tr><td><code>authab_approval_status</code></td><td>read</td><td>Status and execution result for one approval.</td></tr>
          <tr><td><code>authab_search_audit</code></td><td>read</td><td>Recent audit events for this agent, filterable by action.</td></tr>
        </tbody>
      </table>
      <p>
        <code>authab_call</code> is the only tool that changes external systems. Its input schema is generic on purpose:
        the allowed connector and action are enforced server-side by the grant, so a host cannot widen the surface by
        inventing arguments.
      </p>
      <pre>{`// authab_call input
{
  "connector": "slack",
  "action": "slack.post_message",
  "resource": "#research-launch",
  "input": { "channel": "#research-launch", "text": "Launch brief v3." },
  "idempotencyKey": "optional-stable-key"
}`}</pre>
      <p>
        A <code>202</code> comes back as a tool result with <code>status: "pending_approval"</code> and the approval id.
        The host can surface that to the user, or call <code>authab_approval_status</code> later.
      </p>

      <h2 id="gateway">Hosted gateway (Streamable HTTP)</h2>
      <p>
        The hosted gateway speaks MCP Streamable HTTP at <code>POST /api/mcp</code>. It is stateless: there is no SSE
        stream, no session store and no secret key in the client. Instead the client presents a short-lived agent token,
        which you mint server-side with a secret key. Tools are expanded from that agent&apos;s grants at request time —
        one tool per granted action, named after the action (dots become underscores, for example{" "}
        <code>slack_post_message</code>).
      </p>
      <pre>{`# 1. Mint an agent token with a secret key (server-side only)
curl -s https://api.authab.dev/v1/agents/agt_atlas/token \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"ttl": 600}'

# 2. Point an MCP client at the gateway
POST https://app.authab.dev/api/mcp
Authorization: Bearer <agent-token>
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":"2025-06-18","capabilities":{},
           "clientInfo":{"name":"my-host","version":"1.0.0"}}}

{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"slack_post_message",
           "arguments":{"channel":"#support","text":"Escalation triaged.",
                        "resource":"C0123456789"}}}`}</pre>
      <p>
        Supported protocol versions are <code>2025-06-18</code>, <code>2025-03-26</code> and <code>2024-11-05</code>;
        the server negotiates the version during <code>initialize</code> and rejects requests that send an unsupported{" "}
        <code>MCP-Protocol-Version</code> header. <code>GET</code> and <code>DELETE</code> return <code>405</code> because
        the endpoint has no SSE stream or session to close.
      </p>
      <p>
        For the two older protocol versions, <code>POST</code> also accepts a JSON array of up to 20 requests and
        returns one response per request in order, sharing a single bearer token. Notifications produce no response
        entry, an all-notification batch returns <code>202</code>, and <code>initialize</code> must be sent on its own.
        The <code>2025-06-18</code> protocol removed batching, so a request that declares that version must be a single
        JSON-RPC object.
      </p>
      <p>
        Tool schemas follow the grant. Unrestricted grants expose the connector&apos;s declared fields; a grant scoped to
        a resource pattern adds a required <code>resource</code> argument with the pattern in its description. Token
        scopes are applied to the tool list as well, so the gateway never advertises an action the presented token
        cannot call. Results include <code>structuredContent</code> and are capped at 64 KB of text. A denied call comes
        back as <code>isError: true</code> with Authab&apos;s error code, and a provider failure comes back the same way as{" "}
        <code>provider_error</code> or <code>provider_auth_failed</code>; an approval-gated call comes back as a normal
        result with <code>status: "pending_approval"</code> and the approval URL.
      </p>

      <h2 id="registry">Registry manifest</h2>
      <p>
        <code>GET /api/mcp/registry</code> is a public, CORS-enabled manifest for discovery and registry listing. It
        advertises the gateway URL and transport, supported protocol versions, bearer agent-token auth (with the token
        endpoint), capabilities, docs links and the full connector/action catalogue with risk levels. It contains no
        agent data — tools are always computed per token.
      </p>
      <pre>{`curl -s https://app.authab.dev/api/mcp/registry

{
  "name": "dev.authab/gateway",
  "transport": { "type": "streamable-http", "url": "https://app.authab.dev/api/mcp" },
  "protocolVersion": "2025-06-18",
  "authentication": { "scheme": "Bearer", "tokenType": "agent_token",
                      "tokenEndpoint": "https://app.authab.dev/api/v1/agents/{agentId}/token" },
  "connectors": [ { "slug": "slack", "actions": [ { "name": "slack.post_message",
                                                    "risk": "write" } ] } ]
}`}</pre>

      <h2 id="policy">Policy and approvals</h2>
      <p>
        Nothing changes because the caller is an MCP host. Reads flow if granted, writes follow the same grant
        conditions and approval modes, and safe launch applies to promoted agents. Notably, <strong>no MCP tool can
        approve its own request</strong>: decisions require an authenticated human in the dashboard or approval link.
      </p>
      <Callout title="Least privilege for hosts">
        Create a dedicated agent for the host, grant only the actions the user workflow needs, and scope the resource
        pattern. Do not reuse a developer&apos;s personal agent or a <code>*</code> grant.
      </Callout>

      <h2 id="limits">Limits</h2>
      <p>
        Both transports share the same governance. The stdio server runs as one host process, does not persist tokens
        to disk, and logs to stderr so stdout stays a clean MCP stream. The hosted gateway is stateless and applies the
        environment&apos;s per-agent rate limit (120 calls per minute by default), plan quotas and production access
        checks to every call. Tool results are capped at 64 KB over either transport; large provider responses are
        truncated with a marker and the full body remains available in the approval or audit record when applicable.
      </p>
      <p>
        For programmatic use without MCP, use the <Link href="/docs/sdk">SDK</Link>. For the exact policy semantics,
        see <Link href="/docs/concepts/policy">the policy engine</Link>.
      </p>
    </DocsShell>
  );
}
