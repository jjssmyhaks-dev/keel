import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "supabase";
const action = actionFactory(slug);

const data = {
  baseUrlField: "project_url",
  authField: "project_api_key",
  extraHeaders: [{ name: "apikey", field: "project_api_key" }],
};

const supabase: Connector = {
  slug,
  name: "Supabase",
  category: "Developer",
  description: "Manage Supabase projects and infrastructure, or read and write one project's data.",
  color: "#3ECF8E",
  mark: "SB",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "bearer", label: "Personal access token" },
    { type: "api_key", label: "Project API key" },
  ],
  defaultAuth: "bearer",
  hosts: ["api.supabase.com"],
  allowAnyPublicHost: true,
  injection: {
    type: "header",
    name: "Authorization",
    prefix: "Bearer ",
    field: "management_token",
    extraHeaders: [{ name: "apikey", field: "project_api_key" }],
  },
  credentialFields: [
    {
      key: "management_token",
      label: "Personal access token",
      secret: true,
      placeholder: "sbp_…",
      help: "Management mode. Use for project and infrastructure actions.",
    },
    {
      key: "project_url",
      label: "Project URL",
      placeholder: "https://abcdefgh.supabase.co",
      help: "Data mode. Only {ref}.supabase.co hosts are accepted.",
    },
    {
      key: "project_api_key",
      label: "Project API key",
      secret: true,
      placeholder: "eyJ… anon or service_role",
      help: "Data mode. The service_role key bypasses row level security; connections using it are labelled admin risk.",
    },
  ],
  requireAnyFields: ["management_token", "project_url"],
  scopes: [
    { value: "projects:read", label: "Read project metadata", optional: true },
    { value: "database:read", label: "Run read-only SQL", optional: true },
    { value: "database:write", label: "Run write SQL", optional: true },
    { value: "data:read", label: "Read tables and storage", optional: true },
    { value: "data:write", label: "Insert, update and upload", optional: true },
  ],
  resourceLabel: "Project, table or bucket",
  resourcePlaceholder: "abcdefgh",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["management_token", "project_api_key", "apikey", "authorization", "service_role"],
  actions: [
    action("list_projects", "List projects", "GET", "/v1/projects", "read", "List Supabase projects on the account.", {
      mock: { projects: [{ ref: "abcdefgh", name: "acme-prod", status: "ACTIVE_HEALTHY" }] },
    }),
    action("get_project", "Get project", "GET", "/v1/projects/{ref}", "read", "Read project metadata and health.", {
      resourceLabel: "Project",
      mock: { ref: "abcdefgh", name: "acme-prod", region: "ap-south-1" },
    }),
    action("list_functions", "List functions", "GET", "/v1/projects/{ref}/functions", "read", "List edge functions on a project.", {
      resourceLabel: "Project",
      mock: { functions: [{ slug: "stripe-webhook", status: "ACTIVE" }] },
    }),
    action("run_sql_readonly", "Run read-only SQL", "POST", "/v1/projects/{ref}/database/query", "read", "Run one SELECT or EXPLAIN. Anything else is rejected before it leaves the proxy.", {
      resourceLabel: "Project",
      fields: [{ key: "query", label: "SQL", placeholder: "select * from jobs limit 10", required: true }],
      mock: { result: [{ id: 1, status: "queued" }] },
    }),
    action("run_sql_write", "Run write SQL", "POST", "/v1/projects/{ref}/database/query", "admin", "Run a write statement. Always requires approval in production.", {
      resourceLabel: "Project",
      fields: [{ key: "query", label: "SQL", placeholder: "update jobs set status = 'done'", required: true }],
      mock: { result: [{ affected: 3 }] },
    }),
    action("pause_project", "Pause project", "POST", "/v1/projects/{ref}/pause", "admin", "Pause a project's compute.", {
      resourceLabel: "Project",
      mock: { ref: "abcdefgh", status: "PAUSING" },
    }),
    action("restore_project", "Restore project", "POST", "/v1/projects/{ref}/restore", "admin", "Restore a paused project.", {
      resourceLabel: "Project",
      mock: { ref: "abcdefgh", status: "ACTIVE_HEALTHY" },
    }),
    action("list_migrations", "List migrations", "GET", "/v1/projects/{ref}/database/migrations", "read", "List applied database migrations.", {
      resourceLabel: "Project",
      mock: { migrations: [{ version: "20260104", name: "create_jobs" }] },
    }),
    action("apply_migration", "Apply migration", "POST", "/v1/projects/{ref}/database/migrations", "admin", "Apply a migration. Requires approval in production.", {
      resourceLabel: "Project",
      fields: [
        { key: "name", label: "Migration name", placeholder: "add_status_index", required: true },
        { key: "query", label: "SQL", placeholder: "create index…", required: true },
      ],
      mock: { version: "20260201", name: "add_status_index" },
    }),
    action("select_rows", "Select rows", "GET", "/rest/v1/{table}", "read", "Read rows from a table with PostgREST filters.", {
      ...data,
      resourceLabel: "Table",
      fields: [{ key: "select", label: "Columns", placeholder: "id,status" }],
      mock: { rows: [{ id: 1, status: "queued" }] },
    }),
    action("insert_rows", "Insert rows", "POST", "/rest/v1/{table}", "write", "Insert rows into a table.", {
      ...data,
      resourceLabel: "Table",
      fields: [{ key: "rows", label: "Rows (JSON)", placeholder: '[{"status":"queued"}]', required: true }],
      mock: { inserted: 1 },
    }),
    action("update_rows", "Update rows", "PATCH", "/rest/v1/{table}", "write", "Update rows. A filter is mandatory.", {
      ...data,
      resourceLabel: "Table",
      fields: [{ key: "values", label: "Values (JSON)", placeholder: '{"status":"done"}', required: true }],
      mock: { updated: 2 },
    }),
    action("delete_rows", "Delete rows", "DELETE", "/rest/v1/{table}", "destructive", "Delete rows. A filter is mandatory.", {
      ...data,
      resourceLabel: "Table",
      fields: [{ key: "filter", label: "Filter", placeholder: "id=eq.1", required: true }],
      mock: { deleted: 1 },
    }),
    action("list_buckets", "List buckets", "GET", "/storage/v1/bucket", "read", "List storage buckets.", {
      ...data,
      mock: { buckets: [{ id: "avatars", name: "avatars", public: false }] },
    }),
    action("list_objects", "List objects", "POST", "/storage/v1/object/list/{bucket}", "read", "List objects in a bucket.", {
      ...data,
      resourceLabel: "Bucket",
      fields: [{ key: "prefix", label: "Prefix", placeholder: "agents/" }],
      mock: { objects: [{ name: "agents/run-1.json" }] },
    }),
    action("upload_object", "Upload object", "POST", "/storage/v1/object/{bucket}/{path}", "write", "Upload an object to storage.", {
      ...data,
      resourceLabel: "Bucket",
      mock: { Key: "agents/run-2.json" },
    }),
    action("delete_object", "Delete object", "DELETE", "/storage/v1/object/{bucket}/{path}", "destructive", "Delete a stored object.", {
      ...data,
      resourceLabel: "Bucket",
      mock: { deleted: true },
    }),
  ],
};

export default supabase;
