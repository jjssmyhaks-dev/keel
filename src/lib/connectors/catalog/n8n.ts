import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "n8n";
const action = actionFactory(slug);

const n8n: Connector = {
  slug,
  name: "n8n",
  category: "Developer",
  description: "Manage workflows and executions on an n8n Cloud or self-hosted instance.",
  color: "#EA4B71",
  mark: "N8",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "api_key", label: "n8n API key" }],
  defaultAuth: "api_key",
  hosts: ["*.n8n.cloud"],
  allowAnyPublicHost: true,
  baseUrlField: "instance_url",
  injection: { type: "header", name: "X-N8N-API-KEY", field: "api_key" },
  credentialFields: [
    {
      key: "instance_url",
      label: "Instance URL",
      required: true,
      placeholder: "https://acme.app.n8n.cloud",
      help: "n8n Cloud or a public self-hosted URL. Private and link-local hosts are rejected.",
    },
    { key: "api_key", label: "API key", secret: true, required: true, placeholder: "n8n_api_…" },
  ],
  scopes: [{ value: "workflows", label: "Read, edit and activate workflows" }, { value: "executions", label: "Read and delete executions", optional: true }],
  resourceLabel: "Workflow",
  resourcePlaceholder: "42",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["api_key", "x-n8n-api-key", "authorization", "parameters", "data"],
  actions: [
    action("list_workflows", "List workflows", "GET", "/api/v1/workflows", "read", "List workflows with an optional limit.", {
      fields: [{ key: "limit", label: "Limit", placeholder: "10" }],
      sample: { data: [{ id: "42", name: "Lead router", active: true }], nextCursor: null },
    }),
    action("get_workflow", "Get workflow", "GET", "/api/v1/workflows/{id}", "read", "Read one workflow definition.", {
      resourceLabel: "Workflow",
      sample: { id: "42", name: "Lead router", active: true, nodes: [] },
    }),
    action("create_workflow", "Create workflow", "POST", "/api/v1/workflows", "write", "Create a workflow from a name, nodes and connections.", {
      fields: [
        { key: "name", label: "Name", placeholder: "Agent intake", required: true },
        { key: "nodes", label: "Nodes", placeholder: "[]" },
        { key: "connections", label: "Connections", placeholder: "{}" },
      ],
      sample: { id: "43", name: "Agent intake", active: false },
    }),
    action("update_workflow", "Update workflow", "PUT", "/api/v1/workflows/{id}", "write", "Replace a workflow definition.", {
      resourceLabel: "Workflow",
      fields: [
        { key: "name", label: "Name", placeholder: "Agent intake" },
        { key: "nodes", label: "Nodes", placeholder: "[]" },
      ],
      sample: { id: "42", name: "Agent intake", active: false },
    }),
    action("activate_workflow", "Activate workflow", "POST", "/api/v1/workflows/{id}/activate", "write", "Turn a workflow on.", {
      resourceLabel: "Workflow",
      sample: { id: "42", active: true },
    }),
    action("deactivate_workflow", "Deactivate workflow", "POST", "/api/v1/workflows/{id}/deactivate", "write", "Turn a workflow off.", {
      resourceLabel: "Workflow",
      sample: { id: "42", active: false },
    }),
    action("delete_workflow", "Delete workflow", "DELETE", "/api/v1/workflows/{id}", "destructive", "Delete a workflow permanently.", {
      resourceLabel: "Workflow",
      sample: { id: "42", deleted: true },
    }),
    action("list_executions", "List executions", "GET", "/api/v1/executions", "read", "List workflow executions.", {
      fields: [{ key: "limit", label: "Limit", placeholder: "20" }],
      sample: { data: [{ id: "902", workflowId: "42", status: "success" }], nextCursor: null },
    }),
    action("get_execution", "Get execution", "GET", "/api/v1/executions/{id}", "read", "Read one execution including its result data.", {
      resourceLabel: "Execution",
      sample: { id: "902", workflowId: "42", status: "success", data: { resultData: {} } },
    }),
    action("delete_execution", "Delete execution", "DELETE", "/api/v1/executions/{id}", "destructive", "Delete an execution record.", {
      resourceLabel: "Execution",
      sample: { id: "902", deleted: true },
    }),
    action("trigger_webhook", "Trigger webhook", "POST", "/webhook/{path}", "write", "Run a workflow through its production webhook URL.", {
      resourceLabel: "Webhook path",
      fields: [{ key: "path", label: "Webhook path", placeholder: "agent-intake", required: true }],
      sample: { ok: true, workflow: "Lead router" },
    }),
    action("list_tags", "List tags", "GET", "/api/v1/tags", "read", "List workflow tags.", {
      sample: { data: [{ id: "1", name: "production" }] },
    }),
  ],
};

export default n8n;
