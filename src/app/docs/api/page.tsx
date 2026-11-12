import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "API reference",
  description: "REST API for agents, identity documents, revocations, credentials, grants, approvals, audit and webhooks.",
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
      ["GET", "/v1/agents/:id/identity-document", "Secret key", "Current signed identity document (`agent-identity+jwt`) with its JWS and sequence."],
      ["POST", "/v1/agents/:id/pause|resume|suspend|kill", "Secret key", "Change agent status or kill access."],
      ["POST", "/v1/agents/:id/rotate-key", "Secret key", "Rotate the agent keypair."],
      ["POST", "/v1/agents/:id/promote", "Secret key", "Promote a development agent to production."],
      ["GET", "/v1/revocations", "Secret key", "Signed revocation list for the environment; ETag/304, since and cursor pagination."],
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
      ["POST", "/v1/credentials/:id/refresh", "Secret key", "Run the provider refresh grant and persist rotated tokens."],
      ["POST", "/v1/credentials/:id/check", "Secret key", "Probe the provider's read-only health check now."],
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
      ["POST", "/v1/grants/request", "Agent JWT", "Just-in-time access request; creates a pending approval with an SLA."],
      ["POST", "/v1/policy/simulate", "Secret key", "Dry-run a policy decision with the full trace. No provider call."],
      ["GET/POST", "/v1/approval-policies", "API key / secret", "List or create action-pattern policies with SLA minutes."],
      ["GET/PATCH/DELETE", "/v1/approval-policies/:id", "API key / secret", "Read, update or delete a policy."],
    ],
  },
  {
    group: "Agent-native auth",
    rows: [
      ["POST", "/v1/tokens/client-credentials", "Client secret", "OAuth 2.1 client-credentials grant; supports DPoP-bound tokens."],
      ["POST", "/v1/tokens/exchange", "Agent JWT", "RFC 8693 token exchange; cross-agent hops require an active delegation."],
      ["POST", "/v1/tokens/workload-exchange", "Workload JWT", "Exchange a SPIFFE, Kubernetes or OIDC workload JWT for an agent token."],
      ["GET/POST", "/v1/delegations", "API key / secret", "List or record parent-to-child delegations, scoped to the parent's grants."],
      ["DELETE", "/v1/delegations/:id", "Secret key", "Revoke a delegation; tokens issued under it fail on the next call."],
      ["GET/POST", "/v1/workload-identities", "API key / secret", "List or register workload identity trust rules."],
      ["GET/PATCH/DELETE", "/v1/workload-identities/:id", "API key / secret", "Inspect, update or remove a workload identity."],
      ["GET/POST", "/v1/agents/:id/client-secrets", "API key / secret", "List or issue client secrets, narrowed to the agent's grant scopes."],
      ["DELETE", "/v1/agents/:id/client-secrets/:secretId", "Secret key", "Revoke a client secret."],
    ],
  },
  {
    group: "Connectors",
    rows: [
      ["GET", "/v1/connectors", "API key", "Built-in and active custom connectors, plus custom metadata and versions."],
      ["POST", "/v1/connectors", "Secret key", "Import an OpenAPI 3.0/3.1 JSON or YAML document (Scale and Enterprise)."],
      ["GET", "/v1/connectors/:slug", "API key", "Read a custom connector and its version history."],
      ["DELETE", "/v1/connectors/:slug", "Secret key", "Archive a custom connector."],
      ["POST", "/v1/connectors/:slug/rollback", "Secret key", "Restore a previous connector version as a new version."],
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
      updated="12 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#base", name: "Base URL" },
            { href: "#auth", name: "Authentication" },
            { href: "#conventions", name: "Conventions" },
            { href: "#proxy", name: "Proxy contract" },
            { href: "#identity", name: "Identity documents" },
            { href: "#revocations", name: "Revocation list" },
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
          <tr><td>Agent token</td><td><code>Authorization: Bearer eyJ…</code></td><td>Proxy calls, MCP tools and just-in-time grant requests, constrained by the agent&apos;s grants.</td></tr>
          <tr><td>Client secret</td><td><code>client_id</code> + <code>client_secret</code></td><td>Exchange for a short-lived agent token at <code>/v1/tokens/client-credentials</code>.</td></tr>
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

      <h2 id="identity">Agent identity documents</h2>
      <p>
        Every agent carries a current EdDSA-signed identity document that outside parties can verify with the
        platform&apos;s public keys long after the fact. Fetch it with a secret key; the response contains the decoded
        document, its compact JWS and the key that signed it.
      </p>
      <pre>{`GET /v1/agents/agt_atlas/identity-document
Authorization: Bearer sk_live_...

200 {
  "agentId": "agt_atlas",
  "docSeq": 3,
  "document": {
    "v": 1,
    "iss": "https://authab.dev",
    "iat": 1771326000,
    "doc_seq": 3,
    "agent_id": "agt_atlas",
    "key_fingerprint": "b95883be0763a0b0f5ca7428de3d7a8854f6721989e9abc37f1a7627469cb42d",
    "public_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "wX7gtQBGJj2bFxAJCQH..." },
    "org_ref": "575ec432379b8b3788a2592a",
    "environment": "development",
    "status": "active",
    "visibility": "public",
    "created_at": "2026-10-30T09:14:02.000Z"
  },
  "jws": "eyJhbGciOiJFZERTQSIsImtpZCI6IjNXR1dINkI5...",
  "issuerKeyId": "3WGWH6B9qnpzvfMw",
  "issuedAt": "2026-11-12T08:02:00.362Z"
}`}</pre>
      <table>
        <thead>
          <tr><th>Field</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>doc_seq</code></td><td>Starts at 1 and increments on every re-issue. Exactly one document per agent is current; older documents stay verifiable.</td></tr>
          <tr><td><code>key_fingerprint</code></td><td>SHA-256 fingerprint of the agent&apos;s Ed25519 key.</td></tr>
          <tr><td><code>public_jwk</code></td><td>The agent&apos;s public key, so a verifier needs no second lookup.</td></tr>
          <tr><td><code>org_ref</code></td><td>Stable, non-reversible organization reference (24 hex characters). The organization id and name never appear.</td></tr>
          <tr><td><code>status</code></td><td>Snapshot at issue time: <code>active</code>, <code>paused</code>, <code>suspended</code> or <code>revoked</code>. Unknown statuses are treated as revoked.</td></tr>
          <tr><td><code>visibility</code></td><td><code>public</code>, <code>limited</code> or <code>private</code>, set per agent.</td></tr>
          <tr><td><code>environment</code></td><td><code>development</code> or <code>production</code>; it never crosses environments.</td></tr>
        </tbody>
      </table>
      <p>
        Documents are issued when an agent is registered and re-issued whenever its status, key or visibility changes —
        pause, resume, suspend, revoke, kill, rotate-key and visibility updates. Fetching an agent created before
        documents existed backfills one on first read. The request requires a secret key; publishable keys are rejected
        with <code>403 publishable_key_not_allowed</code>.
      </p>
      <p>Verify the JWS offline against the public JWKS; no Authab credential is needed at verification time:</p>
      <pre>{`import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://authab.dev/.well-known/jwks.json"));
const { payload, protectedHeader } = await jwtVerify(jws, jwks, {
  issuer: "https://authab.dev",
  typ: "agent-identity+jwt",
});
if (protectedHeader.kid !== issuerKeyId) throw new Error("unexpected signing key");
if (payload.agent_id !== agentId) throw new Error("wrong agent");`}</pre>
      <p>
        Errors: <code>401</code> for a missing or invalid key, <code>403</code> for publishable keys,{" "}
        <code>404 agent_not_found</code> when the agent is not in the caller&apos;s environment, and{" "}
        <code>503 identity_document_unavailable</code> if issuance failed — retry the request.
      </p>

      <h2 id="revocations">Revocation list</h2>
      <p>
        The revocation list is the pull side of the kill switch. It returns every revoked agent in the caller&apos;s
        environment as a signed JWS, so a verifier can reject credentials without polling each agent. Entries are
        recorded by the kill action, <code>DELETE /v1/agents/:id</code> and revoke. Development and production keys see
        separate lists.
      </p>
      <pre>{`GET /v1/revocations?since=2026-11-01T00:00:00Z&limit=100
Authorization: Bearer sk_live_...

200
ETag: "111fa8834c90c8880566e971ce66b70f4da97830a0ffb2d2373a0c97f186c04b"
Cache-Control: private, max-age=30

{
  "jws": "eyJhbGciOiJFZERTQSIsImtpZCI6IjNXR1dINkI5...",
  "etag": "111fa8834c90c8880566e971ce66b70f4da97830a0ffb2d2373a0c97f186c04b",
  "next": null
}`}</pre>
      <p>The JWS payload:</p>
      <pre>{`{
  "v": 1,
  "iss": "https://authab.dev",
  "iat": 1771326000,
  "exp": 1771326600,
  "environment": "development",
  "revoked": [
    { "agent_id": "agt_atlas", "revoked_at": "2026-11-12T08:02:00.362Z", "reason": "owner_revoked" }
  ]
}`}</pre>
      <table>
        <thead>
          <tr><th>Query or header</th><th>Behaviour</th></tr>
        </thead>
        <tbody>
          <tr><td><code>since</code></td><td>ISO 8601 timestamp, inclusive. Invalid values return <code>422 invalid_since</code>.</td></tr>
          <tr><td><code>limit</code></td><td>1–5000, default 1000. When a page is full, <code>next</code> holds the last row id.</td></tr>
          <tr><td><code>cursor</code></td><td>Pass <code>next</code> from the previous page. Cursors are environment-scoped; a foreign or unknown cursor returns <code>422 invalid_cursor</code>.</td></tr>
          <tr><td><code>If-None-Match</code></td><td>Send the ETag to receive <code>304</code> with no body. The ETag hashes the revoked entries only, so it stays stable while <code>iat</code> and <code>exp</code> move.</td></tr>
        </tbody>
      </table>
      <p>
        <code>exp</code> is ten minutes after <code>iat</code>; refresh the list before it expires. Reasons are{" "}
        <code>owner_revoked</code>, <code>compromised</code>, <code>abuse</code> and <code>expired</code>. The endpoint
        requires a secret key (<code>403</code> for publishable keys) and returns <code>422</code> for invalid query
        parameters.
      </p>
      <pre>{`import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://authab.dev/.well-known/jwks.json"));
const { payload } = await jwtVerify(jws, jwks, {
  issuer: "https://authab.dev",
  typ: "agent-revocations+jwt",
});
const revoked = new Set(payload.revoked.map((entry) => entry.agent_id));`}</pre>
      <p>Poll cheaply with the ETag and resume with the last timestamp:</p>
      <pre>{`let etag = "";
let since = "1970-01-01T00:00:00Z";

for (;;) {
  const url = new URL("https://api.authab.dev/v1/revocations");
  url.searchParams.set("since", since);
  const res = await fetch(url, {
    headers: {
      authorization: "Bearer " + SECRET_KEY,
      ...(etag ? { "if-none-match": etag } : {}),
    },
  });
  if (res.status === 200) {
    const { jws } = await res.json();
    const { payload } = await jwtVerify(jws, jwks, {
      issuer: "https://authab.dev",
      typ: "agent-revocations+jwt",
    });
    applyRevocations(payload.revoked);
    etag = res.headers.get("etag") ?? "";
    since = new Date().toISOString();
  }
  await sleep(30_000);
}`}</pre>

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
