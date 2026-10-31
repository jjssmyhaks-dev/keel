import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "MCP server",
  description: "Expose Keel-governed tools to Claude, Cursor and other MCP hosts.",
};

export default function McpPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="MCP server"
      intro="Give an MCP host — Claude Desktop, Cursor, your own agent loop — a governed set of tools backed by Keel. Every tool call becomes a proxy call with the agent's identity, policy and audit, not a raw provider token in the host's environment."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#why", name: "Why route through Keel" },
            { href: "#run", name: "Run the server" },
            { href: "#clients", name: "Client configuration" },
            { href: "#tools", name: "Tools" },
            { href: "#policy", name: "Policy and approvals" },
            { href: "#limits", name: "Limits" },
          ]}
        />
      }
    >
      <h2 id="why">Why route through Keel</h2>
      <p>
        Most MCP servers hand the host a provider API key and let it call anything the key can reach. Keel instead
        binds the server to one agent. The host sees only the tools the agent has grants for, and every call is
        evaluated and recorded. Revoking the agent turns every tool off at once.
      </p>

      <h2 id="run">Run the server</h2>
      <pre>{`npx @keel/mcp

# environment
KEEL_API_KEY=sk_dev_...          # server-side secret key
KEEL_AGENT_ID=agt_atlas          # the agent whose grants shape the tool list
KEEL_BASE_URL=https://api.keel.dev/v1   # optional`}</pre>
      <p>
        The server mints a short-lived token for <code>KEEL_AGENT_ID</code> on demand and refreshes it before expiry. If
        the agent is paused or killed, tool calls fail with the same <code>agent_inactive</code> error the proxy
        returns.
      </p>

      <h2 id="clients">Client configuration</h2>
      <p>Claude Desktop (<code>claude_desktop_config.json</code>):</p>
      <pre>{`{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "@keel/mcp"],
      "env": {
        "KEEL_API_KEY": "sk_dev_...",
        "KEEL_AGENT_ID": "agt_atlas"
      }
    }
  }
}`}</pre>
      <p>Cursor (<code>.cursor/mcp.json</code>):</p>
      <pre>{`{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "@keel/mcp"],
      "env": {
        "KEEL_API_KEY": "sk_dev_...",
        "KEEL_AGENT_ID": "agt_atlas"
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
          <tr><td><code>keel_whoami</code></td><td>read</td><td>Agent, environment and granted scopes.</td></tr>
          <tr><td><code>keel_list_connections</code></td><td>read</td><td>Connections the agent can reach, with masked hints.</td></tr>
          <tr><td><code>keel_list_actions</code></td><td>read</td><td>Actions available per connection, as granted.</td></tr>
          <tr><td><code>keel_call</code></td><td>governed write</td><td>Proxied connector call: connector, action, resource, input.</td></tr>
          <tr><td><code>keel_pending_approvals</code></td><td>read</td><td>The agent&apos;s pending requests and their ids.</td></tr>
          <tr><td><code>keel_approval_status</code></td><td>read</td><td>Status and execution result for one approval.</td></tr>
          <tr><td><code>keel_search_audit</code></td><td>read</td><td>Recent audit events for this agent, filterable by action.</td></tr>
        </tbody>
      </table>
      <p>
        <code>keel_call</code> is the only tool that changes external systems. Its input schema is generic on purpose:
        the allowed connector and action are enforced server-side by the grant, so a host cannot widen the surface by
        inventing arguments.
      </p>
      <pre>{`// keel_call input
{
  "connector": "slack",
  "action": "slack.post_message",
  "resource": "#research-launch",
  "input": { "channel": "#research-launch", "text": "Launch brief v3." },
  "idempotencyKey": "optional-stable-key"
}`}</pre>
      <p>
        A <code>202</code> comes back as a tool result with <code>status: "pending_approval"</code> and the approval id.
        The host can surface that to the user, or call <code>keel_approval_status</code> later.
      </p>

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
        The server runs over stdio, which means one host process. It does not persist tokens to disk, and it logs to
        stderr so stdout stays a clean MCP stream. Tool results are capped at 64 KB; large provider responses are
        truncated with a marker and the full body remains available in the approval or audit record when applicable.
      </p>
      <p>
        For programmatic use without MCP, use the <Link href="/docs/sdk">SDK</Link>. For the exact policy semantics,
        see <Link href="/docs/concepts/policy">the policy engine</Link>.
      </p>
    </DocsShell>
  );
}
