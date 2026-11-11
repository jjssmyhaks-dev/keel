import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "API reference",
  description: "REST API for agents, credentials, grants, approvals, audit and webhooks.",
};

const endpoints: { group: string; rows: [string, string, string, string][] }[] = [
  {
    group: "Agents",
    rows: [
      ["GET", "/v1/agents", "API key", "List agents. Filters: status, tag, q, limit."],
      ["POST", "/v1/agents", "Secret key", "Register an agent; returns the private key once unless you supplied a public key."],
      ["GET", "/v1/agents/:id", "API key", "Read one agent, keys and grants."],
      ["PATCH", "/v1/agents/:id", "Secret key", "Update name, description, tags, framework, autonomous mode."],
      ["DELETE", "/v1/agents/:id", "Secret key", "Revoke an agent permanently."],
      ["POST", "/v1/agents/:id/token", "Secret key", "Issue a short-lived EdDSA token; supports signed challenges."],
      ["POST", "/v1/agents/:id/pause|resume|suspend|kill", "Secret key", "Change agent status or kill access."],
      ["POST", "/v1/agents/:id/rotate-key", "Secret key", "Rotate the agent keypair."],
      ["POST", "/v1/agents/:id/promote", "Secret key", "Promote a development agent to production."],
    ],
  },
  {
    group: "Vault",
    rows: [
      ["GET", "/v1/credentials", "API key", "List connections. Filter by connector."],
      ["POST", "/v1/credentials", "Secret key", "Create an envelope-encrypted credential."],
      ["GET", "/v1/credentials/:id", "API key", "Metadata, mask, health and grants. Never returns the secret."],
      ["PATCH", "/v1/credentials/:id", "Secret key", "Rotate or update metadata and expiry."],
      ["DELETE", "/v1/credentials/:id", "Secret key", "Revoke the credential."],
    ],
  },
  {
    group: "Grants and policy",
    rows: [
      ["GET", "/v1/grants", "API key", "List grants. Filters: agent, credential."],
      ["POST", "/v1/grants", "Secret key", "Create a grant between an agent and a connection."],
      ["GET", "/v1/grants/:id", "API key", "Read one grant."],
      ["PATCH", "/v1/grants/:id", "Secret key", "Change actions, resource, conditions, mode or expiry."],
      ["DELETE", "/v1/grants/:id", "Secret key", "Remove the grant."],
      ["GET/POST", "/v1/approval-policies", "API key / secret", "List or create action-pattern policies."],
      ["GET/PATCH/DELETE", "/v1/approval-policies/:id", "API key / secret", "Read, update or delete a policy."],
    ],
  },
  {
    group: "Runtime",
    rows: [
      ["POST", "/v1/proxy/:connector", "Agent JWT", "Make a governed call. Returns 200 executed or 202 pending approval."],
      ["POST", "/v1/tokens/introspect", "API key", "Check token validity, agent status and scopes."],
      ["POST", "/v1/tokens/revoke", "Secret key", "Revoke a token by id."],
      ["GET", "/v1/jwks", "Public", "Signing keys for offline JWT verification."],
    ],
  },
  {
    group: "Approvals",
    rows: [
      ["GET", "/v1/approvals", "API key", "List requests. Filters: status, agent, risk, limit."],
      ["GET", "/v1/approvals/:id", "API key", "Read a request, decision and execution result."],
      ["POST", "/v1/approvals/:id", "Secret key", "Approve or deny. Approving executes the call."],
    ],
  },
  {
    group: "Audit and webhooks",
    rows: [
      ["GET", "/v1/audit", "API key", "Query the chain. Filters: action, agent, outcome, from, to, before, order, limit."],
      ["GET", "/v1/audit/verify", "API key", "Verify the hash chain, optionally between seqs."],
      ["GET", "/v1/audit/export", "API key", "Export CSV or JSONL with hash columns."],
      ["GET/POST", "/v1/webhooks", "API key / secret", "List or create signed webhook endpoints."],
      ["GET/PATCH/DELETE", "/v1/webhooks/:id", "API key / secret", "Inspect or manage an endpoint."],
      ["GET", "/v1/openapi", "Public", "Machine-readable OpenAPI document for this API."],
    ],
  },
];

export default function ApiReferencePage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="API reference"
      intro="The REST API is the source of truth. Every dashboard action maps to one of these endpoints, and every endpoint is scoped to the environment of the key or token that calls it."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#base", name: "Base URL" },
            { href: "#auth", name: "Authentication" },
            { href: "#conventions", name: "Conventions" },
            { href: "#proxy", name: "Proxy contract" },
            { href: "#errors", name: "Errors" },
            { href: "#endpoints", name: "Endpoints" },
          ]}
        />
      }
    >
      <h2 id="base">Base URL</h2>
      <pre>{`https://api.authab.dev/v1`}</pre>
      <p>
        The machine-readable specification is at <a href="/api/v1/openapi">/api/v1/openapi</a>. Generate a client from it
        if you are not using the <Link href="/docs/sdk">TypeScript SDK</Link>. Deployments serve the same paths under
        their own origin.
      </p>

      <h2 id="auth">Authentication</h2>
      <table>
        <thead>
          <tr><th>Credential</th><th>Header</th><th>Can do</th></tr>
        </thead>
        <tbody>
          <tr><td>Secret API key <code>sk_…</code></td><td><code>Authorization: Bearer sk_…</code></td><td>Read and write everything in its environment.</td></tr>
          <tr><td>Publishable key <code>pk_…</code></td><td><code>Authorization: Bearer pk_…</code></td><td>Read-only endpoints; introspection.</td></tr>
          <tr><td>Agent token</td><td><code>Authorization: Bearer eyJ…</code></td><td>Proxy calls only, constrained by the agent&apos;s grants.</td></tr>
        </tbody>
      </table>
      <p>
        Keys are environment-bound. A development key never sees production data. Publishable keys cannot create
        agents, credentials or grants, and cannot decide approvals.
      </p>

      <h2 id="conventions">Conventions</h2>
      <ul>
        <li>Request and response bodies are JSON. Send <code>Content-Type: application/json</code> on writes.</li>
        <li>Every response carries <code>x-request-id</code>, also recorded in the audit trail where relevant.</li>
        <li>Timestamps are ISO 8601 UTC. IDs are prefixed: <code>agt_</code>, <code>cred_</code>, <code>grt_</code>, <code>apr_</code>, <code>tok_</code>.</li>
        <li>List endpoints return <code>{"{ object: \"list\", data: [...] }"}</code>. Audit uses a seq cursor with <code>before</code> and <code>order</code>.</li>
        <li>Send <code>Idempotency-Key</code> on proxy calls. Repeated keys replay the stored response; the same key with a different body returns <code>409 idempotency_conflict</code>.</li>
        <li>Successful creates return <code>201</code>; the proxy returns <code>200</code> or <code>202</code>.</li>
      </ul>

      <h2 id="proxy">Proxy contract</h2>
      <pre>{`POST /v1/proxy/slack
Authorization: Bearer <agent-jwt>
Idempotency-Key: post-launch-v3
Content-Type: application/json

{
  "credentialId": "cred_slack_research",   // optional if only one Slack connection exists
  "action": "slack.post_message",
  "resource": "#research-launch",
  "input": { "channel": "#research-launch", "text": "Launch brief v3." }
}

200 {
  "status": "executed",
  "connector": "slack",
  "action": "slack.post_message",
  "result": { "status": 200, "body": { "ok": true }, "latencyMs": 179, "truncated": false },
  "decision": { "effect": "allow", "risk": "write", "source": "grant.approval_mode" },
  "requestId": "req_..."
}`}</pre>
      <p>
        If policy requires a human, the response is <code>202</code> with{" "}
        <code>{"{ status: \"pending_approval\", approval: {...}, approvalUrl }"}</code>. Retrying with the same key after
        the decision yields the final outcome. If the decision was a denial or the request expired, the retry returns{" "}
        <code>403 approval_not_granted</code>.
      </p>
      <p>
        A provider response outside 2xx, or a Slack-style <code>{`{ ok: false }`}</code> credential rejection, is not
        reported as executed: the call returns <code>502 provider_error</code> or{" "}
        <code>provider_auth_failed</code> with the upstream status and body in <code>details</code>.
      </p>
      <Callout title="Connector selection">
        The <code>:connector</code> segment must match the credential&apos;s connector. If <code>credentialId</code> is
        omitted, Authab picks the oldest non-revoked credential for that connector in the environment. Multi-account
        teams should always pass <code>credentialId</code>.
      </Callout>

      <h2 id="errors">Errors</h2>
      <pre>{`{
  "error": {
    "code": "policy_denied",
    "message": "The grant does not include Post message (slack.post_message).",
    "details": { "decision": { "effect": "deny", "source": "grant.actions" } },
    "requestId": "req_..."
  }
}`}</pre>
      <table>
        <thead>
          <tr><th>Status</th><th>Codes</th></tr>
        </thead>
        <tbody>
          <tr><td>400</td><td><code>invalid_json</code></td></tr>
          <tr><td>401</td><td><code>missing_agent_token</code>, <code>invalid_agent_token</code>, <code>token_revoked</code>, <code>invalid_signature</code>, <code>challenge_expired</code></td></tr>
          <tr><td>402</td><td><code>plan_required</code> — production on Free</td></tr>
          <tr><td>403</td><td><code>policy_denied</code>, <code>scope_not_granted</code>, <code>agent_inactive</code>, <code>approval_not_granted</code>, <code>publishable_key_not_allowed</code></td></tr>
          <tr><td>404</td><td><code>unknown_connector</code>, <code>unknown_action</code>, <code>agent_not_found</code>, <code>credential_not_found</code>, <code>grant_not_found</code>, <code>approval_not_found</code></td></tr>
          <tr><td>409</td><td><code>grant_exists</code>, <code>agent_name_taken</code>, <code>approval_closed</code>, <code>idempotency_conflict</code></td></tr>
          <tr><td>422</td><td><code>invalid_name</code>, <code>invalid_actions</code>, <code>secret_required</code>, <code>invalid_mode</code>, <code>promotion_blocked</code></td></tr>
          <tr><td>429</td><td><code>rate_limited</code></td></tr>
          <tr><td>502</td><td><code>execution_failed</code> — approved call failed at the provider; <code>provider_error</code>, <code>provider_auth_failed</code> — upstream rejected the call</td></tr>
        </tbody>
      </table>

      <h2 id="endpoints">Endpoints</h2>
      {endpoints.map((group) => (
        <section key={group.group}>
          <h3>{group.group}</h3>
          <table>
            <thead>
              <tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={`${row[0]} ${row[1]}`}>
                  <td className="whitespace-nowrap"><code>{row[0]}</code></td>
                  <td><code>{row[1]}</code></td>
                  <td className="whitespace-nowrap">{row[2]}</td>
                  <td>{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p>
        For usage patterns, see <Link href="/docs/sdk">the SDK</Link>, <Link href="/docs/cli">the CLI</Link> and{" "}
        <Link href="/docs/concepts/policy">policy concepts</Link>.
      </p>
    </DocsShell>
  );
}
