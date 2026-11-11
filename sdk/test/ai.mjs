import assert from "node:assert/strict";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { agentToolName, buildAgentToolSpecs } from "../dist/index.js";
import { authabAiTools } from "../dist/ai.js";

const catalog = {
  object: "list",
  data: [
    {
      slug: "slack",
      name: "Slack",
      actions: [
        {
          name: "slack.post_message",
          label: "Post message",
          description: "Send a message.",
          risk: "write",
          fields: [
            { key: "channel", label: "Channel", required: true },
            { key: "text", label: "Text", required: true },
          ],
        },
        {
          name: "slack.list_channels",
          label: "List channels",
          description: "List channels.",
          risk: "read",
          fields: [],
        },
        {
          name: "slack.archive_channel",
          label: "Archive channel",
          description: "Archive a channel.",
          risk: "destructive",
          fields: [{ key: "channel", label: "Channel", required: true }],
        },
      ],
    },
  ],
};

const grants = {
  object: "list",
  data: [
    {
      id: "gr_1",
      agentId: "agt_1",
      credentialId: "cred_1",
      actions: ["slack.post_message", "risk:read"],
      resourcePattern: "#eng-*",
      credential: { id: "cred_1", connectorSlug: "slack" },
    },
  ],
};

function fakeAuthab() {
  const calls = [];
  return {
    calls,
    grants: { list: async () => grants },
    connectors: { list: async () => catalog },
    proxy: {
      call: async (input) => {
        calls.push(input);
        return { status: "executed", action: input.action };
      },
    },
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("buildAgentToolSpecs filters to granted actions and scopes resources", async () => {
  const specs = await buildAgentToolSpecs(fakeAuthab(), "agt_1");
  assert.deepEqual(
    specs.map((spec) => spec.name),
    ["slack_list_channels", "slack_post_message"],
  );
  const post = specs.find((spec) => spec.action === "slack.post_message");
  assert.deepEqual(post.inputSchema.required, ["channel", "resource", "text"]);
  assert.equal(post.credentialId, "cred_1");
  assert.equal(post.resourceKey, "resource");
  assert.match(post.description, /Risk: write/);
});

test("agentToolName keeps provider-safe names", () => {
  assert.equal(agentToolName("slack.post_message"), "slack_post_message");
  assert.ok(agentToolName("slack." + "a".repeat(100)).length <= 64);
});

test("authabAiTools returns AI SDK tools that call the proxy", async () => {
  const authab = fakeAuthab();
  const tools = await authabAiTools({ authab, agentId: "agt_1" });
  assert.deepEqual(Object.keys(tools).sort(), ["slack_list_channels", "slack_post_message"]);
  assert.ok(tools.slack_post_message.inputSchema);
  const result = await tools.slack_post_message.execute(
    { channel: "#eng", text: "hello", resource: "#eng-launch" },
    { toolCallId: "call_1", messages: [] },
  );
  assert.equal(result.status, "executed");
  assert.deepEqual(authab.calls[0], {
    connector: "slack",
    action: "slack.post_message",
    resource: "#eng-launch",
    input: { channel: "#eng", text: "hello" },
    credentialId: "cred_1",
    agentId: "agt_1",
  });
});

test("authabAiTools rejects a missing scoped resource", async () => {
  const tools = await authabAiTools({ authab: fakeAuthab(), agentId: "agt_1" });
  await assert.rejects(
    tools.slack_post_message.execute({ channel: "#eng", text: "hello" }, { toolCallId: "call_2", messages: [] }),
    /requires a resource/,
  );
});

test("connector filter narrows the tool set", async () => {
  const tools = await authabAiTools({ authab: fakeAuthab(), agentId: "agt_1", connector: "github" });
  assert.deepEqual(Object.keys(tools), []);
});

test("AI SDK executes a generated tool call end to end", async () => {
  const authab = fakeAuthab();
  const tools = await authabAiTools({ authab, agentId: "agt_1" });
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "slack_post_message",
            input: JSON.stringify({ channel: "#eng", text: "hello", resource: "#eng-launch" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    ],
  });

  const result = await generateText({
    model,
    tools,
    prompt: "Post a message in #eng.",
    stopWhen: stepCountIs(3),
  });

  assert.equal(result.text, "done");
  assert.equal(authab.calls.length, 1);
  assert.equal(authab.calls[0].action, "slack.post_message");
  assert.equal(authab.calls[0].resource, "#eng-launch");
  const toolResult = result.toolResults[0];
  assert.equal(toolResult.output.status, "executed");
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok ${name}`);
}
console.log(`${passed} AI SDK tests passed`);
