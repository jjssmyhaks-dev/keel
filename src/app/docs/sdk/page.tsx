import type { Metadata } from "next";
import Link from "next/link";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "SDKs and integrations",
  description: "Typed TypeScript and Python clients, framework tools and webhook verification for Authab.",
};

export default function SdkPage() {
  return (
    <DocsShell
      eyebrow="Build"
      title="SDKs and integrations"
      intro="Small, server-only clients over the REST API. They handle authentication, retries, idempotency keys and typed errors, so your agent runtime does not have to. Python and TypeScript are mirrored feature for feature, and both ship adapters for the frameworks teams already use."
      updated="13 November 2026"
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
            { href: "#consent", name: "Consent and end users" },
            { href: "#trust", name: "Cross-org trust" },
            { href: "#config", name: "Configuration" },
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
      <p>
        The npm packages ship in the Authab repository; registry publication is pending the public launch. Build the SDK
        from a checkout, then install it into your backend:
      </p>
      <pre>{`git clone https://github.com/jjssmyhaks-dev/keel.git authab
cd authab && npm ci && npm run sdk:build
npm install /path/to/authab/sdk
# Node 20+, server-side only. Never bundle a secret key into a browser.`}</pre>

      <h2 id="client">Client</h2>
      <pre>{`import { Authab } from "@authab/sdk";

const authab = new Authab({
  apiKey: process.env.AUTHAB_API_KEY!,
  baseUrl: "https://api.authab.dev/v1",   // optional
  maxRetries: 2,                        // retries 429 and 5xx
  timeoutMs: 15_000,
});

// The key's environment is the client's environment. There is no
// environment parameter to forget.`}</pre>

      <h2 id="agents">Agents and tokens</h2>
      <pre>{`const agent = await authab.agents.create({
  name: "Atlas Research",
  description: "Summarises research threads.",
  tags: ["research"],
  framework: "langgraph",
  keyMode: "client",            // or "platform"
});
// agent.privateKey is present only on create, only when Authab generated it.

await authab.agents.list({ status: "active", tag: "research" });
await authab.agents.get(agent.id);
await authab.agents.update(agent.id, { description: "Updated" });
await authab.agents.pause(agent.id);
await authab.agents.resume(agent.id);
await authab.agents.kill(agent.id);          // revokes tokens, retires keys

const token = await authab.agents.token(agent.id, { ttl: 300 });
// { accessToken, tokenId, expiresIn, expiresAt, scopes }`}</pre>
      <p>
        With <code>keyMode: "client"</code>, issue tokens by signing a challenge with the private key you hold:
      </p>
      <pre>{`const challenge = \`\${Math.floor(Date.now() / 1000)}.\${randomUUID()}\`;
const signature = sign(agent.privateKey, \`\${agent.id}.\${challenge}\`);

await authab.agents.token(agent.id, { challenge, signature });`}</pre>
      <p>
        The challenge must carry a Unix timestamp within a few minutes of the request. Authab verifies the signature
        against the agent&apos;s active public key and refuses retired keys.
      </p>
      <p>
        The SDK also exposes <code>authab.tokens.introspect(token)</code> and <code>authab.tokens.revoke(tokenId)</code>.
      </p>

      <h2 id="vault">Vault</h2>
      <pre>{`const credential = await authab.vault.create({
  connector: "slack",
  name: "Northwind workspace",
  type: "oauth",
  secret: { accessToken: process.env.SLACK_TOKEN },
  expiresAt: "2027-01-31T00:00:00.000Z",
});

await authab.vault.list({ connector: "slack" });
await authab.vault.get(credential.id);          // metadata + maskedHint
await authab.vault.rotate(credential.id, { secret: { accessToken: nextToken } });
await authab.vault.revoke(credential.id);`}</pre>
      <p>
        <code>vault.get</code> never returns the secret — the API has no read-secret endpoint. Use{" "}
        <code>rotate</code> to replace a value.
      </p>

      <h2 id="grants">Grants</h2>
      <pre>{`const grant = await authab.grants.create({
  agentId: agent.id,
  credentialId: credential.id,
  actions: ["slack.post_message"],
  resourcePattern: "research-*",
  approvalMode: "require_approval",
  conditions: { maxCallsPerPeriod: 40, periodHours: 24 },
  purpose: "Launch briefs",
});

await authab.grants.update(grant.id, { resourcePattern: "research-*,launch-*" });
await authab.grants.remove(grant.id);

await authab.policies.create({ agentId: agent.id, actionPattern: "stripe.*", mode: "deny" });`}</pre>

      <h2 id="proxy">Proxy</h2>
      <pre>{`const result = await authab.proxy.call({
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
        <code>authab.approvals.get</code> once your backend is notified.
      </p>

      <h2 id="approvals">Approvals</h2>
      <pre>{`const pending = await authab.approvals.list({ status: "pending", risk: "financial" });
const approval = await authab.approvals.get("apr_123");

await authab.approvals.decide("apr_123", {
  decision: "approve",
  note: "Duplicate charge confirmed.",
  approveAlways: false,
});`}</pre>
      <p>
        Deciding requires a secret key and the approver role in the dashboard. Approving executes the call with the
        stored payload.
      </p>

      <h2 id="consent">Consent and end users</h2>
      <pre>{`const request = await authab.consent.createRequest({
  agentId: agent.id,
  endUser: { externalUserId: "cust_8812" },
  scopes: ["slack.post_message"],
  redirectUri: "https://app.example.com/authab/callback",
  state: "onboarding-8812",
  durationOptions: ["session", "30d"],
});
// redirect the end user to request.url

// in the redirect handler:
const grant = await authab.consent.exchangeCode({ code, redirectUri });
const next = await authab.consent.mintToken(grant.consentId);
await authab.consent.revoke(grant.consentId, { reason: "customer_revoked" });

const users = await authab.endUsers.list();
const user = await authab.endUsers.get("cust_8812");
const link = await authab.endUsers.controlLink("cust_8812");`}</pre>
      <p>
        Full flow, error codes and safety rules: <Link href="/docs/concepts/end-user-consent">end-user consent</Link>.
      </p>

      <h2 id="trust">Cross-org trust</h2>
      <pre>{`const invitation = await authab.trust.create({
  externalAgentId: "agt_partner_support",
  maxScopes: ["slack.post_message"],
});

const inbound = await authab.trust.list({ side: "external" });
await authab.trust.accept(inbound.relationships[0].id);
await authab.trust.decline(inbound.relationships[1].id);
await authab.trust.revoke(invitation.id);

// on the external agent, using its own token:
const shadow = await authab.tokens.trustExchange({
  trustRelationshipId: invitation.id,
  scopes: ["slack.post_message"],
});`}</pre>
      <p>
        Shadow-agent semantics and the full sequence:{" "}
        <Link href="/docs/concepts/cross-org-trust">cross-organization trust</Link>.
      </p>

      <h2 id="config">Configuration</h2>
      <pre>{`const config = await authab.config.export();          // typed ConfigFile
const yaml = await authab.config.exportYaml();

const plan = await authab.config.apply({ config, dryRun: true });
const result = await authab.config.apply({
  config,
  prune: true,
  confirmPrune: environment === "production",          // x-authab-confirm: prune
});
// result.results?.agents[0].privateKey — shown once`}</pre>
      <p>
        Apply semantics and a CI workflow: <Link href="/docs/gitops">configuration as code</Link>.
      </p>

      <h2 id="audit">Audit</h2>
      <pre>{`const page = await authab.audit.list({ agent: agent.id, limit: 50 });
const next = await authab.audit.list({ before: page.data.at(-1)?.seq, order: "desc" });

const check = await authab.audit.verify();
// { valid: true, eventsChecked: 107, brokenAtSeq: null }

const csv = await authab.audit.export({ format: "csv", from: "2026-10-01" });`}</pre>

      <h2 id="errors">Errors</h2>
      <pre>{`import { AuthabError } from "@authab/sdk";

try {
  await authab.proxy.call({ ... });
} catch (error) {
  if (error instanceof AuthabError && error.code === "policy_denied") {
    console.warn(error.message, error.details?.decision);
  }
}
// Every error has: status, code, message, details, requestId`}</pre>

      <h2 id="webhooks">Webhooks</h2>
      <pre>{`import { verifyWebhook } from "@authab/sdk";

const raw = await request.text();
const valid = verifyWebhook({
  secret: process.env.AUTHAB_WEBHOOK_SECRET!,
  header: request.headers.get("Authab-Signature")!,
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
        The Python SDK mirrors the TypeScript client resource for resource, with no base dependencies: it uses the
        standard library for HTTP, so it drops into any Python 3.9+ worker, notebook or agent runtime. Snake-case
        arguments map to the same camelCase JSON payloads, and retries, idempotency and typed errors behave identically.
      </p>
      <p>
        The SDK ships in this repository; PyPI publication is pending the public launch and final package name. Install
        it from source:
      </p>
      <pre>{`pip install "authab-sdk @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"
pip install "authab-sdk[signing] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"  # Ed25519 client-key mode`}</pre>
      <pre>{`import os
from authab import Authab

authab = Authab.from_env()  # AUTHAB_API_KEY, optional AUTHAB_BASE_URL
# or: Authab(os.environ["AUTHAB_API_KEY"], max_retries=2, timeout_ms=15_000)

agent = authab.agents.create(name="Atlas Research", framework="langgraph", key_mode="client")
result = authab.proxy.call(
    connector="slack",
    action="slack.post_message",
    resource="#research-launch",
    input={"channel": "#research-launch", "text": "Launch brief v3."},
    agent_id=agent["id"],   # the SDK mints and caches this agent's token
)`}</pre>
      <p>Async applications use the same objects through <code>AsyncAuthab</code>, which runs calls on worker threads:</p>
      <pre>{`from authab import AsyncAuthab

authab = AsyncAuthab.from_env()
page = await authab.audit.list(agent=agent_id, limit=50)
pending = await authab.approvals.list(status="pending", limit=20)
approval = await authab.approvals.get(pending["data"][0]["id"])`}</pre>
      <p>
        Client-key agents sign their own challenge. <code>generate_agent_keypair()</code> returns a public key,
        private key and fingerprint; <code>sign_challenge(agent_id, private_key)</code> returns the{" "}
        <code>challenge</code> and <code>signature</code> fields that <code>agents.token</code> expects.
      </p>
      <pre>{`from authab import generate_agent_keypair, sign_challenge

keys = generate_agent_keypair()          # store keys["private_key"] in your secret manager
signed = sign_challenge(agent_id, keys["private_key"])
token = authab.agents.token(
    agent_id, challenge=signed["challenge"], signature=signed["signature"], ttl=300,
)`}</pre>
      <p>
        Webhooks verify with <code>verify_webhook(secret, header, body)</code>, and errors raise <code>AuthabError</code>{" "}
        with <code>code</code>, <code>status</code>, <code>details</code> and <code>request_id</code> — the same shape
        the TypeScript SDK throws.
      </p>

      <h2 id="frameworks">Framework tools</h2>
      <p>
        Each adapter turns the agent&apos;s grants into one tool per granted action, with a JSON schema derived from the
        connector&apos;s declared fields. Calls always go through the Authab proxy with the agent&apos;s identity: the
        framework never sees a provider token, and restricted grants add a required <code>resource</code> argument.
        Install the matching extra; framework packages stay lazily imported, so the base SDK remains dependency-free.
      </p>
      <pre>{`pip install "authab-sdk[langchain] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"   # LangChain + LangGraph
pip install "authab-sdk[crewai] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"
pip install "authab-sdk[openai-agents] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"
pip install "authab-sdk[all] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"`}</pre>
      <pre>{`# LangChain / LangGraph
from authab.integrations.langchain import authab_langchain_tools, authab_langgraph_tool_node

tools = authab_langchain_tools(authab, "agt_atlas")           # StructuredTool list
tool_node = authab_langgraph_tool_node(authab, "agt_atlas")   # ToolNode for a StateGraph

# CrewAI
from authab.integrations.crewai import authab_crewai_tools
researcher = Agent(role="Researcher", tools=authab_crewai_tools(authab, "agt_atlas"), ...)

# OpenAI Agents SDK
from authab.integrations.openai_agents import authab_openai_agents_tools
agent = Agent(name="Atlas", tools=authab_openai_agents_tools(authab, "agt_atlas"))`}</pre>
      <p>
        Pass <code>connector="slack"</code> to narrow the tool list to one provider. Approval-gated calls return a
        result with <code>status: "pending_approval"</code> instead of raising, so the model can stop and surface the
        approval link; policy denials return an error payload the model can read.
      </p>

      <h2 id="ai-sdk">Vercel AI SDK</h2>
      <p>
        The TypeScript SDK exports <code>authabAiTools</code> from <code>@authab/sdk/ai</code>. It returns a{" "}
        <code>ToolSet</code> for use with <code>generateText</code>, <code>streamText</code> and AI SDK agents. The
        package declares <code>ai &gt;= 5</code> as an optional peer, so the core client stays framework-free.
      </p>
      <pre>{`import { generateText, stepCountIs } from "ai";
import { Authab } from "@authab/sdk";
import { authabAiTools } from "@authab/sdk/ai";

const authab = new Authab({ apiKey: process.env.AUTHAB_API_KEY! });
const tools = await authabAiTools({ authab, agentId: "agt_atlas" });

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
