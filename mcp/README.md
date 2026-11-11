# @keel/mcp

An MCP server that lets Claude, Cursor and other MCP hosts use Keel-governed connectors. Every call goes through the same policy, grants, approvals and audit as the API — the model gets tools, not credentials. Zero runtime dependencies; JSON-RPC 2.0 over stdio; Node 20+.

```bash
npm install -g @keel/mcp
```

Configure a host:

```json
{
  "mcpServers": {
    "keel": {
      "command": "keel-mcp",
      "env": {
        "KEEL_API_KEY": "sk_dev_...",
        "KEEL_AGENT_ID": "agt_...",
        "KEEL_BASE_URL": "https://api.keel.dev/v1"
      }
    }
  }
}
```

`KEEL_API_KEY` must be a secret key for the agent's environment. `KEEL_AGENT_ID` fixes the identity the tools run as, so the model cannot choose a different agent. `KEEL_BASE_URL` is optional.

## Tools

| Tool | Purpose |
| --- | --- |
| `keel_whoami` | Confirm the agent, environment, project and granted scopes. |
| `keel_list_connections` | Connections this agent can reach, with masked hints, actions and approval mode. |
| `keel_list_actions` | Granted actions per connection, with risk levels; optional `connector` filter. |
| `keel_call` | Make a governed connector call. Returns `executed` or `pending_approval`; policy denials are errors with a code. |
| `keel_pending_approvals` | This agent's pending approvals. |
| `keel_approval_status` | Status and result of one approval. |
| `keel_search_audit` | Recent audit events, filtered by action prefix or outcome. |

There is deliberately no tool to approve a request. A human decides in the dashboard or from the approval link; the model can only observe status.

## Hosted gateway

For hosted or remote MCP clients, the Keel app itself serves a stateless **Streamable HTTP** gateway at `POST /api/mcp`. It authenticates with a short-lived agent token (minted with a secret key through `POST /api/v1/agents/:id/token`), speaks JSON-RPC 2.0 over POST, and expands the agent's grants into one tool per granted action — `slack_post_message`, `github_list_repos` — with a JSON schema derived from the connector fields. Token scopes narrow the list further, and approvals, policy, rate limits and audit are identical to the stdio server and the REST proxy.

`GET /api/mcp/registry` returns a public, CORS-enabled manifest with the gateway URL, protocol versions, bearer agent-token auth, capabilities and the connector/action catalogue. Use the stdio server below for a local single-agent host; use the gateway when the host cannot hold a secret key or when many agents share one endpoint. Full details are at `/docs/mcp`.

## What the host sees

```text
keel_call { connector: "slack", action: "slack.post_message",
            resource: "#research-launch",
            input: { channel: "#research-launch", text: "Launch brief v3." } }
```

- Executed: `{ status: "executed", result: { ... }, requestId }`.
- Needs approval: `{ status: "pending_approval", approval: { id, risk, ... }, approvalUrl }`.
- Denied or invalid: a tool error with `code` (`policy_denied`, `scope_not_granted`, …) and the request id.

Results are capped at 64 KB; large outputs are truncated with a note. Diagnostics go to stderr only — stdout carries JSON-RPC. Tokens are cached for 10 minutes and refreshed 60 seconds early.

## Development

```bash
npm run sdk:build
npm --prefix mcp run typecheck
npm --prefix mcp run build        # bundles dist/server.js with esbuild
```

Manual smoke test over stdio:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"keel_whoami","arguments":{}}}' \
  | KEEL_API_KEY=sk_dev_... KEEL_AGENT_ID=agt_... node mcp/dist/server.js
```

The server supports `initialize`, `ping`, `tools/list` and `tools/call`, and answers unknown methods with JSON-RPC `-32601`. It ignores notifications and drains queued calls before exiting when stdin closes.
