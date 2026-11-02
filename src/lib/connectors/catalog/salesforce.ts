import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "salesforce";
const action = actionFactory(slug);
const api = "/services/data/v62.0";

const salesforce: Connector = {
  slug,
  name: "Salesforce",
  category: "Commerce",
  description: "Query and edit Salesforce records, inspect objects and run reports in production or a sandbox.",
  color: "#00A1E0",
  mark: "SF",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Salesforce OAuth 2.0 (PKCE)" }],
  defaultAuth: "oauth",
  hosts: ["*.my.salesforce.com", "*.salesforce.com", "*.force.com"],
  allowAnyPublicHost: true,
  baseUrlField: "instance_url",
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "access_token" },
  credentialFields: [
    {
      key: "instance_url",
      label: "Instance URL",
      required: true,
      placeholder: "https://acme.my.salesforce.com",
      help: "Returned by the token response at connect time. Pins the connection to one org.",
    },
    {
      key: "access_token",
      label: "Access token",
      secret: true,
      required: true,
      placeholder: "00D…",
      help: "Access tokens are short lived; reconnect through OAuth to refresh.",
    },
  ],
  scopes: [
    { value: "api", label: "Read and change records" },
    { value: "refresh_token", label: "Refresh access without re-consent" },
  ],
  resourceLabel: "Object or record",
  resourcePlaceholder: "Account",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "email", "phone", "mobilephone"],
  actions: [
    action("query", "Run SOQL", "GET", `${api}/query`, "read", "Run a single SELECT. A LIMIT cap is injected when missing.", {
      fields: [{ key: "q", label: "SOQL", placeholder: "SELECT Id, Name FROM Account LIMIT 10", required: true }],
      mock: { totalSize: 1, done: true, records: [{ Id: "001A", Name: "Acme" }] },
    }),
    action("search", "Run SOSL", "GET", `${api}/search`, "read", "Run a SOSL search.", {
      fields: [{ key: "q", label: "SOSL", placeholder: "FIND {Acme} IN ALL FIELDS RETURNING Account", required: true }],
      mock: { searchRecords: [{ Id: "001A", Name: "Acme" }] },
    }),
    action("list_objects", "List objects", "GET", `${api}/sobjects`, "read", "List available sObjects.", {
      mock: { sobjects: [{ name: "Account", label: "Account" }, { name: "Contact", label: "Contact" }] },
    }),
    action("describe_object", "Describe object", "GET", `${api}/sobjects/{type}/describe`, "read", "Read an object's fields and relationships.", {
      resourceLabel: "Object",
      mock: { name: "Account", fields: [{ name: "Name", type: "string" }] },
    }),
    action("get_record", "Get record", "GET", `${api}/sobjects/{type}/{id}`, "read", "Read one record.", {
      resourceLabel: "Record",
      mock: { Id: "001A", Name: "Acme" },
    }),
    action("create_record", "Create record", "POST", `${api}/sobjects/{type}`, "write", "Create a record.", {
      resourceLabel: "Object",
      fields: [{ key: "Name", label: "Name", placeholder: "Acme", required: true }],
      mock: { id: "001B", success: true },
    }),
    action("update_record", "Update record", "PATCH", `${api}/sobjects/{type}/{id}`, "write", "Update fields on a record.", {
      resourceLabel: "Record",
      fields: [{ key: "Name", label: "Name", placeholder: "Acme Inc" }],
      mock: { id: "001A", success: true },
    }),
    action("delete_record", "Delete record", "DELETE", `${api}/sobjects/{type}/{id}`, "destructive", "Delete a record.", {
      resourceLabel: "Record",
      mock: { id: "001A", deleted: true },
    }),
    action("run_report", "Run report", "GET", `${api}/analytics/reports/{id}`, "read", "Run a stored report.", {
      resourceLabel: "Report",
      mock: { reportMetadata: { name: "Pipeline" }, factMap: {} },
    }),
    action("get_limits", "Get API limits", "GET", `${api}/limits`, "read", "Read daily API usage for the org.", {
      mock: { DailyApiRequests: { Max: 15000, Remaining: 14820 } },
    }),
  ],
};

export default salesforce;
