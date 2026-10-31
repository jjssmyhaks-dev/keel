import type { Metadata } from "next";
import Link from "next/link";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "TypeScript SDK — Keel docs",
  description: "Typed client for Keel agents, vault, grants, approvals, proxy and audit.",
};

export default function SdkPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="TypeScript SDK"
      intro="A small, server-only client over the REST API. It handles authentication, retries, idempotency keys and typed errors, so your agent runtime does not have to."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#install", name: "Install" },
            { href: "#client", name: "Client" },
            { href: "#agents", name: "Agents and tokens" },
            { href: "#vault", name: "Vault" },
            { href: "#grants", name: "Grants" },
            { href: "#proxy", name: "Proxy" },
            { href: "#approvals", name: "Approvals" },
            { href: "#audit", name: "Audit" },
            { href: "#errors", name: "Errors" },
            { href: "#webhooks", name: "Webhooks" },
          ]}
        />
      }
    >
      <h2 id="install">Install</h2>
      <pre>{`npm install @keel/sdk
# Node 20+, server-side only. Never bundle a secret key into a browser.`}</pre>

      <h2 id="client">Client</h2>
      <pre>{`import { Keel } from "@keel/sdk";

const keel = new Keel({
  apiKey: process.env.KEEL_API_KEY!,
  baseUrl: "https://api.keel.dev/v1",   // optional
  maxRetries: 2,                        // retries 429 and 5xx
  timeoutMs: 15_000,
});

// The key's environment is the client's environment. There is no
// environment parameter to forget.`}</pre>

      <h2 id="agents">Agents and tokens</h2>
      <pre>{`const agent = await keel.agents.create({
  name: "Atlas Research",
  description: "Summarises research threads.",
  tags: ["research"],
  framework: "langgraph",
  keyMode: "client",            // or "platform"
});
// agent.privateKey is present only on create, only when Keel generated it.

await keel.agents.list({ status: "active", tag: "research" });
await keel.agents.get(agent.id);
await keel.agents.update(agent.id, { description: "Updated" });
await keel.agents.pause(agent.id);
await keel.agents.resume(agent.id);
await keel.agents.kill(agent.id);          // revokes tokens, retires keys

const token = await keel.agents.token(agent.id, { ttl: 300 });
// { accessToken, tokenId, expiresIn, expiresAt, scopes }`}</pre>
      <p>
        With <code>keyMode: "client"</code>, issue tokens by signing a challenge with the private key you hold:
      </p>
      <pre>{`const challenge = \`\${Math.floor(Date.now() / 1000)}.\${randomUUID()}\`;
const signature = sign(agent.privateKey, \`\${agent.id}.\${challenge}\`);

await keel.agents.token(agent.id, { challenge, signature });`}</pre>
      <p>
        The challenge must carry a Unix timestamp within a few minutes of the request. Keel verifies the signature
        against the agent&apos;s active public key and refuses retired keys.
      </p>
      <p>
        The SDK also exposes <code>keel.tokens.introspect(token)</code> and <code>keel.tokens.revoke(tokenId)</code>.
      </p>

      <h2 id="vault">Vault</h2>
      <pre>{`const credential = await keel.vault.create({
  connector: "slack",
  name: "Northwind workspace",
  type: "oauth",
  secret: { accessToken: process.env.SLACK_TOKEN },
  expiresAt: "2027-01-31T00:00:00.000Z",
});

await keel.vault.list({ connector: "slack" });
await keel.vault.get(credential.id);          // metadata + maskedHint
await keel.vault.rotate(credential.id, { secret: { accessToken: nextToken } });
await keel.vault.revoke(credential.id);`}</pre>
      <p>
        <code>vault.get</code> never returns the secret — the API has no read-secret endpoint. Use{" "}
        <code>rotate</code> to replace a value.
      </p>

      <h2 id="grants">Grants</h2>
      <pre>{`const grant = await keel.grants.create({
  agentId: agent.id,
  credentialId: credential.id,
  actions: ["slack.post_message"],
  resourcePattern: "research-*",
  approvalMode: "require_approval",
  conditions: { maxCallsPerPeriod: 40, periodHours: 24 },
  purpose: "Launch briefs",
});

await keel.grants.update(grant.id, { resourcePattern: "research-*,launch-*" });
await keel.grants.remove(grant.id);

await keel.policies.create({ agentId: agent.id, actionPattern: "stripe.*", mode: "deny" });`}</pre>

      <h2 id="proxy">Proxy</h2>
      <pre>{`const result = await keel.proxy.call({
  connector: "slack",
  token,                       // agent JWT; or pass agentId + let the SDK mint one
  action: "slack.post_message",
  resource: "#research-launch",
  input: { channel: "#research-launch", text: "Launch brief v3." },
  idempotencyKey: "launch-v3",
});

if (result.status === "executed") {
  console.log(result.result.body);
} else if (result.status === "pending_approval") {
  await storeForLater(result.approval.id);
}`}</pre>
      <p>
        The SDK generates a stable idempotency key when you omit one. It does not automatically retry{" "}
        <code>202</code> responses; poll with the same key or read the approval through{" "}
        <code>keel.approvals.get</code> once your backend is notified.
      </p>

      <h2 id="approvals">Approvals</h2>
      <pre>{`const pending = await keel.approvals.list({ status: "pending", risk: "financial" });
const approval = await keel.approvals.get("apr_123");

await keel.approvals.decide("apr_123", {
  decision: "approve",
  note: "Duplicate charge confirmed.",
  approveAlways: false,
});`}</pre>
      <p>
        Deciding requires a secret key and the approver role in the dashboard. Approving executes the call with the
        stored payload.
      </p>

      <h2 id="audit">Audit</h2>
      <pre>{`const page = await keel.audit.list({ agent: agent.id, limit: 50 });
const next = await keel.audit.list({ before: page.data.at(-1)?.seq, order: "desc" });

const check = await keel.audit.verify();
// { valid: true, eventsChecked: 107, brokenAtSeq: null }

const csv = await keel.audit.export({ format: "csv", from: "2026-10-01" });`}</pre>

      <h2 id="errors">Errors</h2>
      <pre>{`import { KeelError } from "@keel/sdk";

try {
  await keel.proxy.call({ ... });
} catch (error) {
  if (error instanceof KeelError && error.code === "policy_denied") {
    console.warn(error.message, error.details?.decision);
  }
}
// Every error has: status, code, message, details, requestId`}</pre>

      <h2 id="webhooks">Webhooks</h2>
      <pre>{`import { verifyWebhook } from "@keel/sdk";

const raw = await request.text();
const valid = verifyWebhook({
  secret: process.env.KEEL_WEBHOOK_SECRET!,
  header: request.headers.get("Keel-Signature")!,
  body: raw,
  toleranceSeconds: 300,
});
// Validates t=...,v1=HMAC-SHA256(timestamp.body)`}</pre>
      <p>
        See <Link href="/docs/api">the API reference</Link> for the underlying endpoints and{" "}
        <Link href="/docs/concepts/audit">audit</Link> for delivery semantics.
      </p>
    </DocsShell>
  );
}
