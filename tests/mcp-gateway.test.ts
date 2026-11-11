import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTORS, type Connector } from "../src/lib/connectors";
import {
  GatewayToolInputError,
  buildGatewayTools,
  expandGrantActions,
  extractGatewayInput,
  gatewayToolName,
  mcpErrorResult,
  mcpToolDefinition,
  mcpToolResult,
  type GatewayGrant,
  type GatewayTool,
} from "../src/lib/mcp-tools";
import {
  executeGatewayTool,
  proxyResponseToToolResult,
  type GatewayProxyCall,
  type ProxyInvoker,
} from "../src/lib/mcp-gateway";
import { GET as registryGet, OPTIONS as registryOptions } from "../src/app/api/mcp/registry/route";
import { DELETE as mcpDelete, GET as mcpGet, POST as mcpPost } from "../src/app/api/mcp/route";

const slack = CONNECTORS.find((entry) => entry.slug === "slack")!;
const github = CONNECTORS.find((entry) => entry.slug === "github")!;

const slackGrant: GatewayGrant = {
  credentialId: "cred_slack",
  actions: ["*"],
  resourcePattern: "*",
  connectorSlug: "slack",
};

const githubGrant: GatewayGrant = {
  credentialId: "cred_github",
  actions: ["github.list_repos", "risk:destructive"],
  resourcePattern: "*",
  connectorSlug: "github",
};

test("tool names are model-safe and stable", () => {
  assert.equal(gatewayToolName("slack.post_message"), "slack_post_message");
  assert.equal(gatewayToolName("github.merge_pull_request"), "github_merge_pull_request");
  const long = gatewayToolName(`acme.${"very_".repeat(20)}dangerous_action`);
  assert.ok(long.length <= 64);
  assert.match(long, /_[0-9a-f]{8}$/);
  assert.notEqual(long, gatewayToolName(`acme.${"very_".repeat(20)}other_action`));
});

test("grant actions expand exact names, risks, wildcards and globs", () => {
  assert.deepEqual(
    expandGrantActions(slack, ["*"]).map((action) => action.name),
    slack.actions.map((action) => action.name),
  );
  assert.deepEqual(
    expandGrantActions(github, ["risk:destructive"]).map((action) => action.name),
    ["github.merge_pull_request"],
  );
  assert.deepEqual(
    expandGrantActions(github, ["destructive"]).map((action) => action.name),
    ["github.merge_pull_request"],
  );
  assert.deepEqual(
    expandGrantActions(github, ["github.*_repos"]).map((action) => action.name),
    ["github.list_repos"],
  );
  assert.deepEqual(expandGrantActions(github, ["nothing.matches"]), []);
});

test("gateway tools follow grants and omit ungranted actions", () => {
  const tools = buildGatewayTools(CONNECTORS, [slackGrant, githubGrant]);
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("slack_post_message"));
  assert.ok(names.includes("slack_list_channels"));
  assert.ok(names.includes("github_list_repos"));
  assert.ok(names.includes("github_merge_pull_request"));
  assert.ok(!names.includes("github_create_issue"));
  assert.deepEqual([...names].sort(), names);
});

test("tool annotations describe risk", () => {
  const tools = buildGatewayTools(CONNECTORS, [githubGrant]);
  const list = mcpToolDefinition(tools.find((tool) => tool.name === "github_list_repos")!);
  const merge = mcpToolDefinition(tools.find((tool) => tool.name === "github_merge_pull_request")!);
  assert.equal((list.annotations as { readOnlyHint: boolean }).readOnlyHint, true);
  assert.equal((merge.annotations as { destructiveHint: boolean }).destructiveHint, true);
  assert.equal((merge.annotations as { readOnlyHint: boolean }).readOnlyHint, false);
});

test("restricted grants require a matching resource", () => {
  const tools = buildGatewayTools(CONNECTORS, [
    { ...slackGrant, actions: ["slack.post_message"], resourcePattern: "channel:*" },
  ]);
  assert.equal(tools.length, 1);
  const tool = tools[0];
  assert.equal(tool.resourceKey, "resource");
  const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
  assert.ok(schema.required.includes("channel"));
  assert.ok(schema.required.includes("text"));
  assert.ok(schema.required.includes("resource"));
  assert.match(tool.description, /channel:\*/);
});

test("a resource input field cannot collide with the call resource", () => {
  const synthetic = {
    slug: "synthetic",
    name: "Synthetic",
    category: "Test",
    description: "Test connector",
    color: "#000",
    mark: "S",
    docsUrl: "https://example.com",
    authMethods: [{ type: "api_key", label: "API key" }],
    defaultAuth: "api_key",
    hosts: ["example.com"],
    injection: { type: "header", name: "authorization" },
    scopes: [],
    resourceLabel: "Record",
    resourcePlaceholder: "record_1",
    actions: [
      {
        name: "synthetic.update",
        label: "Update",
        description: "Update a record.",
        method: "POST",
        path: "/records/{resource}",
        risk: "write",
        fields: [{ key: "resource", label: "Record", required: true }],
      },
    ],
    status: "stable",
    version: "1.0.0",
    redactedFields: [],
  } as unknown as Connector;

  const [tool] = buildGatewayTools([synthetic], [
    {
      credentialId: "cred_synthetic",
      actions: ["synthetic.update"],
      resourcePattern: "record:*",
      connectorSlug: "synthetic",
    },
  ]);
  assert.equal(tool.resourceKey, "_keel_resource");

  const { input, resource } = extractGatewayInput(tool, {
    resource: "record_1",
    _keel_resource: "record_2",
  });
  assert.equal(resource, "record_2");
  assert.equal(input.resource, "record_1");
});

test("missing restricted resource is rejected before execution", () => {
  const tool = buildGatewayTools(CONNECTORS, [
    { ...slackGrant, actions: ["slack.post_message"], resourcePattern: "channel:*" },
  ])[0];
  assert.throws(
    () => extractGatewayInput(tool, { channel: "#support", text: "hi" }),
    GatewayToolInputError,
  );
});

test("an optional resource argument is routed to the proxy", () => {
  const tool = buildGatewayTools(CONNECTORS, [slackGrant]).find(
    (entry) => entry.name === "slack_post_message",
  )!;
  const { input, resource } = extractGatewayInput(tool, {
    channel: "#support",
    text: "hi",
    resource: "C123",
  });
  assert.equal(resource, "C123");
  assert.deepEqual(input, { channel: "#support", text: "hi" });
});

test("token scopes further narrow a wildcard grant", () => {
  const scoped = buildGatewayTools(CONNECTORS, [slackGrant], { scopes: ["slack.post_message"] });
  assert.deepEqual(
    scoped.map((tool) => tool.name),
    ["slack_post_message"],
  );
  const wildcard = buildGatewayTools(CONNECTORS, [slackGrant], { scopes: ["slack.*"] });
  assert.deepEqual(wildcard.map((tool) => tool.name), [
    "slack_list_channels",
    "slack_post_message",
    "slack_read_channel",
  ]);
  assert.deepEqual(buildGatewayTools(CONNECTORS, [slackGrant], { scopes: ["github.*"] }), []);
});

test("connector filter and duplicate names are handled", () => {
  const onlyGithub = buildGatewayTools(CONNECTORS, [slackGrant, githubGrant], { connector: "github" });
  assert.ok(onlyGithub.every((tool) => tool.connector === "github"));

  const duplicated = buildGatewayTools(CONNECTORS, [
    { ...slackGrant, actions: ["slack.post_message"] },
    { ...slackGrant, credentialId: "cred_slack_backup", actions: ["slack.post_message"] },
  ]);
  assert.deepEqual(
    duplicated.map((tool) => [tool.name, tool.credentialId]),
    [
      ["slack_post_message", "cred_slack"],
      ["slack_post_message_2", "cred_slack_backup"],
    ],
  );
});

test("tool results carry structured content and cap oversized bodies", () => {
  const small = mcpToolResult({ status: "executed", result: { ok: true } });
  assert.equal(small.isError, false);
  assert.deepEqual(small.structuredContent, { status: "executed", result: { ok: true } });

  const huge = mcpToolResult({ body: "x".repeat(70 * 1024) });
  const text = (huge.content as { text: string }[])[0].text;
  assert.ok(text.endsWith("… truncated at 64 KB …"));
  assert.equal("structuredContent" in huge, false);

  const failure = mcpErrorResult({ code: "policy_denied", message: "Nope.", requestId: "req_1" });
  assert.equal(failure.isError, true);
  assert.equal(
    (failure.structuredContent as { error: { code: string } }).error.code,
    "policy_denied",
  );
});

function restrictedTool(): GatewayTool {
  return buildGatewayTools(CONNECTORS, [
    { ...slackGrant, actions: ["slack.post_message"], resourcePattern: "channel:*" },
  ])[0];
}

test("executing a tool forwards identity, credential and resource to the proxy", async () => {
  const calls: GatewayProxyCall[] = [];
  const invoke: ProxyInvoker = async (call) => {
    calls.push(call);
    return { status: 200, payload: { status: "executed", result: { status: 200, body: { ok: true } } } };
  };

  const result = await executeGatewayTool({
    tool: restrictedTool(),
    arguments: { channel: "#support", text: "Escalation", resource: "C42" },
    authorization: "Bearer agent-token",
    idempotencyKey: "mcp_test_1",
    invoke,
  });

  assert.equal(calls.length, 1);
  const seen = calls[0];
  assert.equal(seen.authorization, "Bearer agent-token");
  assert.equal(seen.connector, "slack");
  assert.equal(seen.action, "slack.post_message");
  assert.equal(seen.resource, "C42");
  assert.equal(seen.credentialId, "cred_slack");
  assert.equal(seen.idempotencyKey, "mcp_test_1");
  assert.deepEqual(seen.input, { channel: "#support", text: "Escalation" });
  assert.equal(result.isError, false);
  assert.equal((result.structuredContent as { status: string }).status, "executed");
});

test("pending approvals and denials keep their Keel semantics", async () => {
  const pending = proxyResponseToToolResult({
    status: 202,
    payload: {
      status: "pending_approval",
      approval: { id: "apr_1", status: "pending" },
      approvalUrl: "https://keel.dev/approve/token",
    },
  });
  assert.equal(pending.isError, false);
  assert.equal((pending.structuredContent as { status: string }).status, "pending_approval");

  const denied = await executeGatewayTool({
    tool: restrictedTool(),
    arguments: { channel: "#general", text: "Hello", resource: "C1" },
    authorization: "Bearer agent-token",
    invoke: async () => ({
      status: 403,
      payload: {
        error: {
          code: "policy_denied",
          message: "This agent may not write to this channel.",
          requestId: "req_denied",
        },
      },
    }),
  });
  assert.equal(denied.isError, true);
  const error = (denied.structuredContent as { error: { code: string; requestId: string } }).error;
  assert.equal(error.code, "policy_denied");
  assert.equal(error.requestId, "req_denied");
});

test("invalid tool input never reaches the proxy", async () => {
  let called = false;
  const result = await executeGatewayTool({
    tool: restrictedTool(),
    arguments: { channel: "#support", text: "No resource" },
    authorization: "Bearer agent-token",
    invoke: async () => {
      called = true;
      return { status: 200, payload: {} };
    },
  });
  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.equal(
    (result.structuredContent as { error: { code: string } }).error.code,
    "invalid_input",
  );
});

test("executions get a fresh MCP idempotency key by default", async () => {
  const keys: string[] = [];
  await executeGatewayTool({
    tool: restrictedTool(),
    arguments: { channel: "#support", text: "One", resource: "C1" },
    authorization: "Bearer agent-token",
    invoke: async (call) => {
      keys.push(call.idempotencyKey);
      return { status: 200, payload: { status: "executed" } };
    },
  });
  assert.match(keys[0], /^mcp_[0-9a-f-]{36}$/);
  assert.match(keys[0], /^mcp_/);
});

test("MCP endpoint enforces JSON-RPC and bearer auth", async () => {
  const unauthenticated = await mcpPost(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
  );
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /Bearer/);
  const authBody = await unauthenticated.json();
  assert.equal(authBody.error.code, -32001);
  assert.equal(authBody.error.data.keelCode, "missing_agent_token");

  const malformed = await mcpPost(
    new Request("http://localhost:3000/api/mcp", { method: "POST", body: "{not json" }),
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, -32700);

  const batch = await mcpPost(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
    }),
  );
  assert.equal(batch.status, 400);
  assert.equal((await batch.json()).error.code, -32600);

  const version = await mcpPost(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "mcp-protocol-version": "1999-01-01" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    }),
  );
  assert.equal(version.status, 400);
  assert.match((await version.json()).error.message, /Unsupported MCP protocol version/);

  const get = await mcpGet();
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  const del = await mcpDelete();
  assert.equal(del.status, 405);
});

test("registry manifest advertises the gateway, auth and connector catalogue", async () => {
  const response = await registryGet(new Request("http://localhost:3000/api/mcp/registry"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const manifest = await response.json();
  assert.equal(manifest.name, "dev.keel/gateway");
  assert.equal(manifest.title, "Keel MCP Gateway");
  assert.equal(manifest.protocolVersion, "2025-06-18");
  assert.ok(manifest.protocolVersions.includes("2024-11-05"));
  assert.equal(manifest.transport.type, "streamable-http");
  assert.equal(manifest.transport.url, "http://localhost:3000/api/mcp");
  assert.equal(manifest.remotes[0].url, "http://localhost:3000/api/mcp");
  assert.equal(manifest.authentication.scheme, "Bearer");
  assert.match(manifest.authentication.tokenEndpoint, /\/api\/v1\/agents\/\{agentId\}\/token$/);
  assert.equal(manifest.connectors.length, CONNECTORS.length);
  const slackEntry = manifest.connectors.find((entry: { slug: string }) => entry.slug === "slack");
  assert.ok(slackEntry.actions.some((action: { name: string }) => action.name === "slack.post_message"));

  const options = await registryOptions();
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
});
