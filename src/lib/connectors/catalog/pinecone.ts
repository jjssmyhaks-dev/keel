import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "pinecone";
const action = actionFactory(slug);

const data = { baseUrlField: "index_host" };

const pinecone: Connector = {
  slug,
  name: "Pinecone",
  category: "AI & data",
  description: "Query, upsert and manage vectors and namespaces across Pinecone indexes.",
  color: "#000000",
  mark: "PC",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "api_key", label: "Pinecone API key" }],
  defaultAuth: "api_key",
  hosts: ["api.pinecone.io", "*.pinecone.io"],
  allowAnyPublicHost: true,
  injection: {
    type: "header",
    name: "Api-Key",
    field: "api_key",
    extraHeaders: [{ name: "X-Pinecone-API-Version", value: "2025-04" }],
  },
  credentialFields: [
    { key: "api_key", label: "API key", secret: true, required: true, placeholder: "pcsk_…" },
    {
      key: "index_host",
      label: "Index host",
      placeholder: "https://acme-memory-abc123.svc.aped-4627-b74a.pinecone.io",
      help: "Required for data-plane actions (query, fetch, upsert). Discovered from describe_index.",
    },
  ],
  scopes: [
    { value: "indexes:read", label: "List and describe indexes" },
    { value: "vectors:read", label: "Query and fetch vectors", optional: true },
    { value: "vectors:write", label: "Upsert and update vectors", optional: true },
    { value: "vectors:delete", label: "Delete vectors and namespaces", optional: true },
  ],
  resourceLabel: "Index or namespace",
  resourcePlaceholder: "agent-memory",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["api_key", "values", "metadata", "vector"],
  actions: [
    action("list_indexes", "List indexes", "GET", "/indexes", "read", "List indexes in the project.", {
      mock: { indexes: [{ name: "agent-memory", dimension: 3072, metric: "cosine" }] },
    }),
    action("describe_index", "Describe index", "GET", "/indexes/{name}", "read", "Read an index's host, dimension and metric.", {
      resourceLabel: "Index",
      mock: { name: "agent-memory", host: "agent-memory-abc.svc.pinecone.io", dimension: 3072 },
    }),
    action("describe_index_stats", "Index stats", "POST", "/describe_index_stats", "read", "Read vector counts per namespace.", {
      ...data,
      resourceLabel: "Index",
      mock: { namespaces: { "tenant-a": { vectorCount: 1284 } } },
    }),
    action("query", "Query vectors", "POST", "/query", "read", "Query by vector with a top-k cap and optional metadata filter.", {
      ...data,
      resourceLabel: "Namespace",
      fields: [
        { key: "vector", label: "Vector", placeholder: "[0.12, …]" },
        { key: "topK", label: "Top K", placeholder: "5" },
        { key: "namespace", label: "Namespace", placeholder: "tenant-a" },
      ],
      mock: { matches: [{ id: "mem_1", score: 0.92 }] },
    }),
    action("fetch_vectors", "Fetch vectors", "GET", "/vectors/fetch", "read", "Fetch vectors by ID.", {
      ...data,
      resourceLabel: "Namespace",
      fields: [{ key: "ids", label: "IDs", placeholder: "mem_1,mem_2" }],
      mock: { vectors: { mem_1: { id: "mem_1", values: [] } } },
    }),
    action("upsert_vectors", "Upsert vectors", "POST", "/vectors/upsert", "write", "Upsert vectors. Chunked to the provider batch size.", {
      ...data,
      resourceLabel: "Namespace",
      fields: [
        { key: "vectors", label: "Vectors (JSON)", placeholder: '[{"id":"mem_2","values":[…]}]', required: true },
        { key: "namespace", label: "Namespace", placeholder: "tenant-a" },
      ],
      mock: { upsertedCount: 1 },
    }),
    action("update_vector", "Update vector", "POST", "/vectors/update", "write", "Update a vector's values or metadata.", {
      ...data,
      resourceLabel: "Namespace",
      fields: [{ key: "id", label: "Vector ID", placeholder: "mem_1", required: true }],
      mock: { updated: true },
    }),
    action("delete_vectors", "Delete vectors", "POST", "/vectors/delete", "destructive", "Delete vectors. Delete-all in a namespace needs approval.", {
      ...data,
      resourceLabel: "Namespace",
      fields: [
        { key: "ids", label: "IDs", placeholder: "mem_1" },
        { key: "deleteAll", label: "Delete all", placeholder: "false" },
        { key: "namespace", label: "Namespace", placeholder: "tenant-a" },
      ],
      mock: { deleted: 1 },
    }),
    action("create_index", "Create index", "POST", "/indexes", "admin", "Create a billable index.", {
      fields: [
        { key: "name", label: "Name", placeholder: "agent-memory", required: true },
        { key: "dimension", label: "Dimension", placeholder: "3072", required: true },
        { key: "metric", label: "Metric", placeholder: "cosine" },
      ],
      mock: { name: "agent-memory", dimension: 3072, status: "Ready" },
    }),
    action("delete_index", "Delete index", "DELETE", "/indexes/{name}", "destructive", "Delete an index and its vectors.", {
      resourceLabel: "Index",
      mock: { name: "agent-memory", deleted: true },
    }),
    action("list_namespaces", "List namespaces", "GET", "/namespaces", "read", "List namespaces in an index.", {
      ...data,
      resourceLabel: "Index",
      mock: { namespaces: [{ name: "tenant-a", recordCount: 1284 }] },
    }),
  ],
};

export default pinecone;
