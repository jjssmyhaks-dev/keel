import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "airtable";
const action = actionFactory(slug);

const airtable: Connector = {
  slug,
  name: "Airtable",
  category: "Productivity",
  description: "Read and write records in Airtable bases, with schema discovery and per-base rate limiting.",
  color: "#FFBF00",
  mark: "AI",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "oauth", label: "Airtable OAuth (PKCE)" },
    { type: "api_key", label: "Personal access token" },
  ],
  defaultAuth: "api_key",
  hosts: ["api.airtable.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
  credentialFields: [
    {
      key: "token",
      label: "Personal access token",
      secret: true,
      required: true,
      placeholder: "pat…",
      help: "Scope the token to the bases and tables this agent needs.",
    },
  ],
  scopes: [
    { value: "data.records:read", label: "Read records" },
    { value: "data.records:write", label: "Create, update and delete records", optional: true },
    { value: "schema.bases:read", label: "List bases and read schemas" },
  ],
  resourceLabel: "Base or table",
  resourcePlaceholder: "appXXXXXX",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["token", "authorization"],
  actions: [
    action("list_bases", "List bases", "GET", "/v0/meta/bases", "read", "List bases the token can access.", {
      sample: { bases: [{ id: "appXXXXXX", name: "Agent Ops" }] },
    }),
    action("get_base_schema", "Get base schema", "GET", "/v0/meta/bases/{baseId}/tables", "read", "List tables and fields in a base.", {
      resourceLabel: "Base",
      sample: { tables: [{ id: "tbl1", name: "Runs", fields: [{ name: "Status" }] }] },
    }),
    action("list_records", "List records", "GET", "/v0/{baseId}/{table}", "read", "List records with filterByFormula, view and offset paging.", {
      resourceLabel: "Table",
      fields: [
        { key: "filterByFormula", label: "Filter", placeholder: "{Status}='queued'" },
        { key: "maxRecords", label: "Max records", placeholder: "20" },
      ],
      sample: { records: [{ id: "rec1", fields: { Status: "queued" } }] },
    }),
    action("get_record", "Get record", "GET", "/v0/{baseId}/{table}/{recordId}", "read", "Read one record.", {
      resourceLabel: "Table",
      sample: { id: "rec1", fields: { Status: "queued" } },
    }),
    action("create_records", "Create records", "POST", "/v0/{baseId}/{table}", "write", "Create records. The connector chunks batches over 10.", {
      resourceLabel: "Table",
      fields: [{ key: "records", label: "Records (JSON)", placeholder: '[{"fields":{"Status":"queued"}}]', required: true }],
      sample: { records: [{ id: "rec2", fields: { Status: "queued" } }] },
    }),
    action("update_records", "Update records", "PATCH", "/v0/{baseId}/{table}", "write", "Update records. Chunked like create.", {
      resourceLabel: "Table",
      fields: [{ key: "records", label: "Records (JSON)", placeholder: '[{"id":"rec1","fields":{"Status":"done"}}]', required: true }],
      sample: { records: [{ id: "rec1", fields: { Status: "done" } }] },
    }),
    action("delete_records", "Delete records", "DELETE", "/v0/{baseId}/{table}", "destructive", "Delete records by ID.", {
      resourceLabel: "Table",
      fields: [{ key: "records", label: "Record IDs", placeholder: "rec1,rec2", required: true }],
      sample: { records: [{ id: "rec1", deleted: true }] },
    }),
    action("create_comment", "Create comment", "POST", "/v0/{baseId}/{table}/{recordId}/comments", "write", "Comment on a record.", {
      resourceLabel: "Table",
      fields: [{ key: "text", label: "Comment", placeholder: "Reviewed by agent", required: true }],
      sample: { id: "com1", text: "Reviewed by agent" },
    }),
  ],
};

export default airtable;
