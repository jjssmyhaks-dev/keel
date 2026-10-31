# @keel/sdk

Server-side TypeScript client for [Keel](https://keel.dev/docs/sdk). Node 20+. Never bundle a secret key into a browser.

```bash
npm install @keel/sdk
```

## Client

```ts
import { Keel } from "@keel/sdk";

const keel = new Keel({
  apiKey: process.env.KEEL_API_KEY!,
  baseUrl: "https://api.keel.dev/v1", // optional
  maxRetries: 2,
  timeoutMs: 15_000,
});

const me = await keel.me();
// { organization, project, environment, key }
```

The key's environment is the client's environment. There is no environment parameter to forget.

## Agents and tokens

```ts
const agent = await keel.agents.create({
  name: "Atlas Research",
  description: "Summarises research threads.",
  tags: ["research"],
  framework: "langgraph",
  keyMode: "client", // or "platform"
});
// agent.privateKey is returned once, only when Keel generated it.

const token = await keel.agents.token(agent.id, { ttl: 300 });
// { accessToken, tokenId, expiresIn, expiresAt, scopes }
```

For client-key-mode agents, pass `privateKey` and the SDK signs the challenge:

```ts
await keel.agents.token(agent.id, { privateKey: agent.privateKey!, ttl: 300 });
// or sign yourself with signChallenge(agentId, privateKey)
```

Management: `list`, `get`, `update`, `pause`, `resume`, `suspend`, `kill`, `rotateKey`, `transfer`, `previewPromotion`, `promote`.

## Vault

```ts
const credential = await keel.vault.create({
  connector: "slack",
  name: "Northwind workspace",
  type: "oauth",
  secret: { accessToken: process.env.SLACK_TOKEN },
});

await keel.vault.list({ connector: "slack" });
await keel.vault.get(credential.id);              // metadata + maskedHint, never the secret
await keel.vault.rotate(credential.id, { secret: { accessToken: nextToken } });
await keel.vault.revoke(credential.id);
```

## Grants, policy and approvals

```ts
const grant = await keel.grants.create({
  agentId: agent.id,
  credentialId: credential.id,
  actions: ["slack.post_message"],
  resourcePattern: "research-*",
  approvalMode: "require_approval",
  conditions: { maxCallsPerPeriod: 40, periodHours: 24 },
  purpose: "Launch briefs",
});

await keel.policies.create({ agentId: agent.id, actionPattern: "stripe.*", mode: "deny" });

const pending = await keel.approvals.list({ status: "pending", risk: "financial" });
await keel.approvals.approve("apr_123", { note: "Duplicate charge confirmed." });
```

## Proxy

```ts
const result = await keel.proxy.call({
  connector: "slack",
  agentId: agent.id,          // mint a token, or pass token directly
  action: "slack.post_message",
  resource: "#research-launch",
  input: { channel: "#research-launch", text: "Launch brief v3." },
  idempotencyKey: "launch-v3",
});

if (result.status === "executed") console.log(result.result.body);
else console.log(result.approval.id, result.approvalUrl);
```

A pending approval is a normal return value. A policy denial throws `KeelError` with `code: "policy_denied"` and `details.decision`.

## Audit and webhooks

```ts
const page = await keel.audit.list({ agent: agent.id, limit: 50 });
const check = await keel.audit.verify();            // { valid, eventsChecked, brokenAtSeq }
const csv = await keel.audit.export({ format: "csv" });

import { verifyWebhook } from "@keel/sdk";
const valid = verifyWebhook({
  secret: process.env.KEEL_WEBHOOK_SECRET!,
  header: request.headers.get("Keel-Signature")!,
  body: rawBody,
});
```

## Errors

```ts
import { KeelError } from "@keel/sdk";

try {
  await keel.proxy.call({ ... });
} catch (error) {
  if (error instanceof KeelError && error.code === "policy_denied") {
    console.warn(error.message, error.details);
  }
}
```

Every `KeelError` has `status`, `code`, `message`, `details?` and `requestId?`. Transport failures use `status: 0` with `network_error` or `timeout`. The client retries `429`, and retries `5xx`/transport failures for reads and idempotent proxy calls, with exponential backoff and jitter.
