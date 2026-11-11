import type { Metadata } from "next";
import Link from "next/link";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "SDKs and integrations",
  description: "Typed TypeScript and Python clients, framework tools and webhook verification for Keel.",
};

export default function SdkPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="SDKs and integrations"
      intro="Small, server-only clients over the REST API. They handle authentication, retries, idempotency keys and typed errors, so your agent runtime does not have to. Python and TypeScript are mirrored feature for feature, and both ship adapters for the frameworks teams already use."
      updated="11 November 2026"
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
            { href: "#python", name: "Python SDK" },
            { href: "#frameworks", name: "Framework tools" },
            { href: "#ai-sdk", name: "Vercel AI SDK" },
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

      <h2 id="python">Python SDK</h2>
      <p>
        <code>keel-sdk</code> mirrors the TypeScript client resource for resource, with no base dependencies: it uses
        the standard library for HTTP, so it drops into any Python 3.9+ worker, notebook or agent runtime. Snake-case
        arguments map to the same camelCase JSON payloads, and retries, idempotency and typed errors behave identically.
      </p>
      <pre>{`pip install keel-sdk
pip install "keel-sdk[signing]"   # Ed25519 client-key mode (cryptography)`}</pre>
      <pre>{`import os
from keel import Keel

keel = Keel.from_env()  # KEEL_API_KEY, optional KEEL_BASE_URL
# or: Keel(os.environ["KEEL_API_KEY"], max_retries=2, timeout_ms=15_000)

agent = keel.agents.create(name="Atlas Research", framework="langgraph", key_mode="client")
result = keel.proxy.call(
    connector="slack",
    action="slack.post_message",
    resource="#research-launch",
    input={"channel": "#research-launch", "text": "Launch brief v3."},
    agent_id=agent["id"],   # the SDK mints and caches this agent's token
)`}</pre>
      <p>Async applications use the same objects through <code>AsyncKeel</code>, which runs calls on worker threads:</p>
      <pre>{`from keel import AsyncKeel

keel = AsyncKeel.from_env()
page = await keel.audit.list(agent=agent_id, limit=50)
pending = await keel.approvals.list(status="pending", limit=20)
approval = await keel.approvals.get(pending["data"][0]["id"])`}</pre>
      <p>
        Client-key agents sign their own challenge. <code>generate_agent_keypair()</code> returns a public key,
        private key and fingerprint; <code>sign_challenge(agent_id, private_key)</code> returns the{" "}
        <code>challenge</code> and <code>signature</code> fields that <code>agents.token</code> expects.
      </p>
      <pre>{`from keel import generate_agent_keypair, sign_challenge

keys = generate_agent_keypair()          # store keys["private_key"] in your secret manager
signed = sign_challenge(agent_id, keys["private_key"])
token = keel.agents.token(
    agent_id, challenge=signed["challenge"], signature=signed["signature"], ttl=300,
)`}</pre>
      <p>
        Webhooks verify with <code>verify_webhook(secret, header, body)</code>, and errors raise <code>KeelError</code>{" "}
        with <code>code</code>, <code>status</code>, <code>details</code> and <code>request_id</code> — the same shape
        the TypeScript SDK throws.
      </p>

      <h2 id="frameworks">Framework tools</h2>
      <p>
        Each adapter turns the agent&apos;s grants into one tool per granted action, with a JSON schema derived from the
        connector&apos;s declared fields. Calls always go through the Keel proxy with the agent&apos;s identity: the
        framework never sees a provider token, and restricted grants add a required <code>resource</code> argument.
        Install the matching extra; framework packages stay lazily imported, so the base SDK remains dependency-free.
      </p>
      <pre>{`pip install "keel-sdk[langchain]"      # LangChain + LangGraph
pip install "keel-sdk[crewai]"
pip install "keel-sdk[openai-agents]"
pip install "keel-sdk[all]"`}</pre>
      <pre>{`# LangChain / LangGraph
from keel.integrations.langchain import keel_langchain_tools, keel_langgraph_tool_node

tools = keel_langchain_tools(keel, "agt_atlas")           # StructuredTool list
tool_node = keel_langgraph_tool_node(keel, "agt_atlas")   # ToolNode for a StateGraph

# CrewAI
from keel.integrations.crewai import keel_crewai_tools
researcher = Agent(role="Researcher", tools=keel_crewai_tools(keel, "agt_atlas"), ...)

# OpenAI Agents SDK
from keel.integrations.openai_agents import keel_openai_agents_tools
agent = Agent(name="Atlas", tools=keel_openai_agents_tools(keel, "agt_atlas"))`}</pre>
      <p>
        Pass <code>connector="slack"</code> to narrow the tool list to one provider. Approval-gated calls return a
        result with <code>status: "pending_approval"</code> instead of raising, so the model can stop and surface the
        approval link; policy denials return an error payload the model can read.
      </p>

      <h2 id="ai-sdk">Vercel AI SDK</h2>
      <p>
        The TypeScript SDK exports <code>keelAiTools</code> from <code>@keel/sdk/ai</code>. It returns a{" "}
        <code>ToolSet</code> for use with <code>generateText</code>, <code>streamText</code> and AI SDK agents. The
        package declares <code>ai &gt;= 5</code> as an optional peer, so the core client stays framework-free.
      </p>
      <pre>{`import { generateText, stepCountIs } from "ai";
import { Keel } from "@keel/sdk";
import { keelAiTools } from "@keel/sdk/ai";

const keel = new Keel({ apiKey: process.env.KEEL_API_KEY! });
const tools = await keelAiTools({ keel, agentId: "agt_atlas" });

const result = await generateText({
  model: yourModel,
  tools,
  stopWhen: stepCountIs(5),
  prompt: "Summarise #research-launch and post the brief.",
});`}</pre>
      <p>
        The same grant expansion powers the <Link href="/docs/mcp">hosted MCP gateway</Link>, so a tool named{" "}
        <code>slack_post_message</code> means the same thing in an AI SDK loop, a LangGraph node and an MCP host.
      </p>
    </DocsShell>
  );
}
