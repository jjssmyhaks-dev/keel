import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "huggingface";
const action = actionFactory(slug);

const huggingface: Connector = {
  slug,
  name: "Hugging Face",
  category: "AI & data",
  description: "Search models, datasets and spaces, run inference and manage repositories and endpoints.",
  color: "#FFD21E",
  mark: "HF",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "bearer", label: "Hugging Face access token" }],
  defaultAuth: "bearer",
  hosts: ["huggingface.co", "router.huggingface.co", "api.endpoints.huggingface.cloud"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
  credentialFields: [
    {
      key: "token",
      label: "Access token",
      secret: true,
      required: true,
      placeholder: "hf_…",
      help: "Use a fine-grained token scoped to the repos and endpoints this agent needs.",
    },
  ],
  scopes: [
    { value: "models:read", label: "Search models and read model cards" },
    { value: "datasets:read", label: "Search datasets", optional: true },
    { value: "spaces:read", label: "Search spaces", optional: true },
    { value: "inference", label: "Run inference", optional: true },
    { value: "repos:write", label: "Create, upload and delete repositories", optional: true },
    { value: "endpoints:write", label: "Create and manage inference endpoints", optional: true },
  ],
  resourceLabel: "Repository or endpoint",
  resourcePlaceholder: "meta-llama/Llama-3.1-8B",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["token", "authorization", "inputs", "text"],
  actions: [
    action("search_models", "Search models", "GET", "/api/models", "read", "Search the model hub.", {
      fields: [{ key: "search", label: "Search", placeholder: "llama" }],
      mock: [{ id: "meta-llama/Llama-3.1-8B", downloads: 12000000 }],
    }),
    action("get_model", "Get model", "GET", "/api/models/{repo}", "read", "Read a model card and metadata.", {
      resourceLabel: "Model",
      mock: { id: "meta-llama/Llama-3.1-8B", pipeline_tag: "text-generation" },
    }),
    action("search_datasets", "Search datasets", "GET", "/api/datasets", "read", "Search the dataset hub.", {
      mock: [{ id: "acme/agent-traces", downloads: 4200 }],
    }),
    action("get_dataset", "Get dataset", "GET", "/api/datasets/{repo}", "read", "Read a dataset card.", {
      resourceLabel: "Dataset",
      mock: { id: "acme/agent-traces", cardData: {} },
    }),
    action("search_spaces", "Search spaces", "GET", "/api/spaces", "read", "Search Spaces.", {
      mock: [{ id: "acme/agent-demo", sdk: "gradio" }],
    }),
    action("get_space", "Get space", "GET", "/api/spaces/{repo}", "read", "Read a Space's metadata and status.", {
      resourceLabel: "Space",
      mock: { id: "acme/agent-demo", runtime: { stage: "RUNNING" } },
    }),
    action("list_repo_files", "List repo files", "GET", "/api/{repo}/tree/main", "read", "List files in a repository.", {
      resourceLabel: "Repository",
      mock: [{ path: "config.json", size: 812 }],
    }),
    action("download_file", "Download file", "GET", "/{repo}/resolve/{revision}/{path}", "read", "Download a small file. Large model files are blocked.", {
      resourceLabel: "Repository",
      mock: { path: "config.json", size: 812, content: "{}" },
    }),
    action("run_inference", "Run inference", "POST", "/models/{repo}", "write", "Run a model through the inference router. Tokens count toward spend caps.", {
      host: "router.huggingface.co",
      resourceLabel: "Model",
      fields: [
        { key: "inputs", label: "Inputs", placeholder: "Summarise this…", required: true },
        { key: "parameters", label: "Parameters", placeholder: '{"max_new_tokens":128}' },
      ],
      mock: [{ generated_text: "Summary…" }],
    }),
    action("create_repo", "Create repository", "POST", "/api/repos/create", "write", "Create a model, dataset or Space repository.", {
      fields: [
        { key: "name", label: "Name", placeholder: "agent-traces", required: true },
        { key: "type", label: "Type", placeholder: "dataset" },
        { key: "private", label: "Private", placeholder: "true" },
      ],
      mock: { url: "https://huggingface.co/datasets/acme/agent-traces" },
    }),
    action("upload_file", "Upload file", "POST", "/api/{repo}/commit/main", "write", "Commit a file to a repository.", {
      resourceLabel: "Repository",
      fields: [{ key: "path", label: "Path", placeholder: "data/traces.jsonl", required: true }],
      mock: { commitOid: "9f2a", success: true },
    }),
    action("delete_repo", "Delete repository", "DELETE", "/api/repos/delete", "destructive", "Delete a repository permanently.", {
      resourceLabel: "Repository",
      fields: [{ key: "name", label: "Repository", placeholder: "acme/agent-traces", required: true }],
      mock: { deleted: true },
    }),
    action("restart_space", "Restart space", "POST", "/api/spaces/{repo}/restart", "write", "Restart a Space.", {
      resourceLabel: "Space",
      mock: { runtime: { stage: "RUNNING" } },
    }),
    action("pause_space", "Pause space", "POST", "/api/spaces/{repo}/pause", "write", "Pause a Space.", {
      resourceLabel: "Space",
      mock: { runtime: { stage: "PAUSED" } },
    }),
    action("list_inference_endpoints", "List inference endpoints", "GET", "/api/endpoints", "read", "List Inference Endpoints.", {
      resourceLabel: "Endpoint",
      mock: { endpoints: [{ name: "llama-prod", status: { state: "running" } }] },
    }),
    action("create_inference_endpoint", "Create inference endpoint", "POST", "/api/endpoints", "financial", "Create a billable inference endpoint.", {
      fields: [{ key: "name", label: "Name", placeholder: "llama-prod", required: true }],
      mock: { name: "llama-prod", status: { state: "initializing" } },
    }),
    action("scale_inference_endpoint", "Scale endpoint", "PUT", "/api/endpoints/{name}/scale", "financial", "Change an endpoint's replicas or hardware.", {
      resourceLabel: "Endpoint",
      fields: [{ key: "replicas", label: "Replicas", placeholder: "2" }],
      mock: { name: "llama-prod", replicas: 2 },
    }),
    action("delete_inference_endpoint", "Delete endpoint", "DELETE", "/api/endpoints/{name}", "destructive", "Delete an inference endpoint.", {
      resourceLabel: "Endpoint",
      mock: { name: "llama-prod", deleted: true },
    }),
  ],
};

export default huggingface;
