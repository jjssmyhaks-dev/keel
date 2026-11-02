import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "cursor";
const action = actionFactory(slug);

const cursor: Connector = {
  slug,
  name: "Cursor",
  category: "Developer",
  description: "Launch and manage Cursor cloud agents, models and repositories from platform agents.",
  color: "#000000",
  mark: "CU",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "api_key", label: "Cursor API key" }],
  defaultAuth: "api_key",
  hosts: ["api.cursor.com"],
  injection: {
    type: "header",
    name: "Authorization",
    basic: { usernameField: "api_key", passwordField: "api_key_password", allowEmptyPassword: true },
  },
  credentialFields: [
    {
      key: "api_key",
      label: "Cursor API key",
      secret: true,
      required: true,
      placeholder: "key_…",
      help: "Sent as HTTP Basic with the key as the username and an empty password.",
    },
  ],
  scopes: [{ value: "cloud_agents", label: "Launch and manage cloud agents on allowed repositories" }],
  resourceLabel: "Repository or agent",
  resourcePlaceholder: "acme/checkout",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["api_key", "authorization", "prompt", "conversation"],
  actions: [
    action("get_me", "Get account", "GET", "/v0/me", "read", "Read the authenticated Cursor account.", {
      sample: { id: "user_8f2k", email: "dev@acme.dev", name: "Acme Platform" },
    }),
    action("list_models", "List models", "GET", "/v0/models", "read", "List models available to the API key.", {
      sample: { models: [{ id: "claude-4-sonnet" }, { id: "gpt-5" }] },
    }),
    action("list_repositories", "List repositories", "GET", "/v0/repositories", "read", "List repositories Cursor can access.", {
      sample: { repositories: [{ url: "github.com/acme/checkout", defaultBranch: "main" }] },
    }),
    action("list_agents", "List agents", "GET", "/v0/agents", "read", "List cloud agents with cursor pagination.", {
      fields: [{ key: "limit", label: "Limit", placeholder: "20" }],
      sample: { agents: [{ id: "bc_1a2b", status: "finished" }], nextCursor: null },
    }),
    action("get_agent", "Get agent", "GET", "/v0/agents/{id}", "read", "Read one cloud agent and its status.", {
      resourceLabel: "Agent",
      sample: { id: "bc_1a2b", status: "running", repository: "github.com/acme/checkout" },
    }),
    action("get_conversation", "Get conversation", "GET", "/v0/agents/{id}/conversation", "read", "Read an agent conversation.", {
      resourceLabel: "Agent",
      sample: { id: "bc_1a2b", messages: [{ role: "assistant", type: "message" }] },
    }),
    action("launch_agent", "Launch agent", "POST", "/v0/agents", "write", "Start a cloud agent on a repository. Poll get_agent until it finishes.", {
      resourceLabel: "Repository",
      fields: [
        { key: "prompt", label: "Prompt", placeholder: "Add tests for the billing module", required: true },
        { key: "repository", label: "Repository", placeholder: "github.com/acme/checkout" },
        { key: "branch", label: "Branch", placeholder: "main" },
        { key: "model", label: "Model", placeholder: "claude-4-sonnet" },
      ],
      sample: { id: "bc_new7", status: "queued", repository: "github.com/acme/checkout" },
    }),
    action("add_followup", "Add follow-up", "POST", "/v0/agents/{id}/followup", "write", "Send a follow-up instruction to a running agent.", {
      resourceLabel: "Agent",
      fields: [{ key: "prompt", label: "Prompt", placeholder: "Also update the changelog", required: true }],
      sample: { id: "bc_new7", status: "queued" },
    }),
    action("stop_agent", "Stop agent", "POST", "/v0/agents/{id}/stop", "write", "Stop a running cloud agent.", {
      resourceLabel: "Agent",
      sample: { id: "bc_new7", status: "stopped" },
    }),
    action("delete_agent", "Delete agent", "DELETE", "/v0/agents/{id}", "destructive", "Delete a cloud agent and its conversation.", {
      resourceLabel: "Agent",
      sample: { id: "bc_new7", deleted: true },
    }),
  ],
};

export default cursor;
