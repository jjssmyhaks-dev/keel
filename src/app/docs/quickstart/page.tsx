import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";
import { demoLoginEnabled } from "@/lib/demo";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Register an agent, connect a provider, grant one action and make your first governed call.",
};

export default function QuickstartPage() {
  return (
    <DocsShell
      eyebrow="Getting started · 10 minutes"
      title="From zero to a governed call."
      intro="This walkthrough registers an agent with its own Ed25519 key, stores a Slack credential, grants exactly one action, makes a proxied call, then checks the audit trail. Every request below is also available in the dashboard."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#install", name: "1. Install and authenticate" },
            { href: "#agent", name: "2. Register an agent" },
            { href: "#credential", name: "3. Store a credential" },
            { href: "#grant", name: "4. Grant one action" },
            { href: "#token", name: "5. Issue a token" },
            { href: "#call", name: "6. Make the call" },
            { href: "#audit", name: "7. Read the audit trail" },
            { href: "#next", name: "What next" },
          ]}
        />
      }
    >
      {demoLoginEnabled() ? (
        <Callout title="Using the demo workspace">
          The hosted demo ships with <code>demo@keel.dev</code> and the development key{" "}
          <code>sk_dev_demo_northwind_2026</code>. The examples below work against it without registering anything. Do
          not use demo keys in production.
        </Callout>
      ) : null}

      <h2 id="install">1. Install and authenticate</h2>
      <p>
        The SDK talks to the same REST API the dashboard uses. Install it in the backend that will run your agents —
        never in a browser bundle.
      </p>
      <pre>{`npm install @keel/sdk

export KEEL_API_KEY=sk_dev_...   # Settings → Developers → API keys`}</pre>
      <p>
        Secret keys can register agents, write credentials and change permissions. Publishable keys (<code>pk_…</code>)
        can read status and introspect tokens. Both must be sent as <code>Authorization: Bearer …</code>.
      </p>

      <h2 id="agent">2. Register an agent</h2>
      <p>
        An agent is a cryptographic principal, not a service account. Keel generates an Ed25519 keypair and returns the
        public key, fingerprint and — once — the private key. Store that private key in your own secret manager, or use{" "}
        <code>keyMode: "platform"</code> to have Keel custody it.
      </p>
      <pre>{`const keel = new Keel(process.env.KEEL_API_KEY!);

const agent = await keel.agents.create({
  name: "Atlas Research",
  description: "Summarises research threads and drafts launch briefs.",
  framework: "langgraph",
  tags: ["research", "slack"],
});

console.log(agent.id);          // agt_...
console.log(agent.fingerprint); // SHA-256 of the public key
console.log(agent.privateKey);  // shown exactly once`}</pre>
      <p>Or with curl:</p>
      <pre>{`curl -X POST https://api.keel.dev/v1/agents \\
  -H "Authorization: Bearer $KEEL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Atlas Research","framework":"langgraph"}'`}</pre>

      <h2 id="credential">3. Store a credential</h2>
      <p>
        Credentials are envelope-encrypted: a project master key wraps a per-credential data key, which encrypts the
        secret with AES-256-GCM. The plaintext never leaves the request that created it and is never returned by the
        API — only a masked hint such as <code>••••8f2a</code>.
      </p>
      <pre>{`const credential = await keel.vault.create({
  connector: "slack",
  name: "Northwind workspace",
  type: "oauth",
  secret: { accessToken: process.env.SLACK_BOT_TOKEN },
  metadata: { workspace: "northwind" },
});`}</pre>
      <p>
        You can also link a connection from the dashboard at <Link href="/app/vault/new">Vault → New connection</Link>.
        Dashboard-created and API-created credentials are identical; both can be rotated and revoked.
      </p>

      <h2 id="grant">4. Grant one action</h2>
      <p>
        A grant is the only way an agent reaches a credential. Name the exact actions, scope the resource with a glob,
        and choose when a human must approve. Anything not listed is denied.
      </p>
      <pre>{`await keel.grants.create({
  agentId: agent.id,
  credentialId: credential.id,
  actions: ["slack.post_message"],
  resourcePattern: "research-*",
  approvalMode: "require_approval",
  purpose: "Post launch briefs to research channels",
  conditions: { periodHours: 24, maxCallsPerPeriod: 40 },
});`}</pre>
      <p>
        <code>approvalMode</code> overrides the environment default. Leave it unset and the risk-based default applies —
        see <Link href="/docs/concepts/policy">the policy engine</Link> for the full evaluation order.
      </p>

      <h2 id="token">5. Issue a token</h2>
      <p>
        Agents authenticate with a short-lived EdDSA JWT (five minutes by default, one hour maximum). Your backend
        asks Keel for one; the agent never holds your API key.
      </p>
      <pre>{`const { accessToken, expiresAt } = await keel.agents.token(agent.id, { ttl: 300 });

// The JWT carries: sub, agent id, environment, project, org,
// scopes derived from active grants, and a unique jti.`}</pre>
      <p>
        Agents that hold their own key can mint tokens themselves by signing a challenge (client-held mode), so the
        platform key never leaves your infrastructure. Tokens are revocable before expiry through{" "}
        <Link href="/docs/api">POST /v1/tokens/revoke</Link>.
      </p>

      <h2 id="call">6. Make the call</h2>
      <p>
        Call the connector through Keel. The proxy injects the credential, evaluates policy, redacts the response, and
        records the event. Idempotency keys make retries safe.
      </p>
      <pre>{`const response = await fetch("https://api.keel.dev/v1/proxy/slack", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${accessToken}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "slack-post-launch-v3",
  },
  body: JSON.stringify({
    credentialId: credential.id,
    action: "slack.post_message",
    resource: "#research-launch",
    input: { channel: "#research-launch", text: "Launch brief v3 is ready." },
  }),
});

const body = await response.json();
// 200 → { status: "executed", result: { status, body, latencyMs }, decision }
// 202 → { status: "pending_approval", approval: { id, ... }, approvalUrl }
// 403 → { error: { code: "policy_denied", message, decision } }`}</pre>

      <Callout tone="warning" title="A 202 is not a failure">
        When a human is required, Keel returns <code>202</code> with an approval id and URL. Retry the identical
        request with the same <code>Idempotency-Key</code> after the decision; Keel replays the stored outcome instead
        of calling the provider twice.
      </Callout>

      <h2 id="audit">7. Read the audit trail</h2>
      <p>
        Every token issuance, proxy call, policy denial and approval is appended to a per-environment hash chain. Each
        event stores <code>prevHash</code> and <code>hash</code>, so deleting or editing a row breaks verification.
      </p>
      <pre>{`const { data } = await keel.audit.list({ agent: agent.id, limit: 10 });
const verification = await keel.audit.verify();
// { valid: true, eventsChecked: 107, brokenAtSeq: null }`}</pre>
      <p>
        Export the raw chain as CSV or JSONL from <Link href="/app/activity">Activity</Link>, or subscribe to proxy,
        approval and agent events with webhooks. See <Link href="/docs/concepts/audit">Audit trail</Link>.
      </p>

      <h2 id="next">What next</h2>
      <ul>
        <li>
          <Link href="/docs/concepts/policy">Policy engine</Link> — the exact evaluation order and approval defaults.
        </li>
        <li>
          <Link href="/docs/concepts/environments">Environments and promotion</Link> — move a tested agent to
          production with a grant diff.
        </li>
        <li>
          <Link href="/docs/sdk">SDKs and integrations</Link>, <Link href="/docs/cli">CLI</Link>, or{" "}
          <Link href="/docs/mcp">MCP server and gateway</Link> for each surface.
        </li>
        <li>
          <Link href="/app/approvals">Approvals inbox</Link> — the human side of the loop.
        </li>
      </ul>
    </DocsShell>
  );
}
