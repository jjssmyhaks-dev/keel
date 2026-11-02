import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "cloudflare";
const action = actionFactory(slug);

const cloudflare: Connector = {
  slug,
  name: "Cloudflare",
  category: "Developer",
  description: "Manage zones, DNS, cache, Workers, R2 buckets and firewall rules with a scoped API token.",
  color: "#F38020",
  mark: "CF",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "bearer", label: "Scoped API token" }],
  defaultAuth: "bearer",
  hosts: ["api.cloudflare.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "api_token" },
  credentialFields: [
    {
      key: "api_token",
      label: "API token",
      secret: true,
      required: true,
      placeholder: "v1.0-…",
      help: "Create a scoped token. Global API keys are not supported.",
    },
    { key: "account_id", label: "Account ID", placeholder: "023e105f…", help: "Required for Workers and R2 actions." },
  ],
  scopes: [
    { value: "zone:read", label: "Read zones" },
    { value: "dns:read", label: "Read DNS records", optional: true },
    { value: "dns:write", label: "Create, change and delete DNS records", optional: true },
    { value: "cache:purge", label: "Purge cache", optional: true },
    { value: "workers:read", label: "List Workers scripts", optional: true },
    { value: "r2:read", label: "List R2 buckets", optional: true },
    { value: "firewall:read", label: "Read firewall rules", optional: true },
    { value: "firewall:write", label: "Create and delete firewall rules", optional: true },
  ],
  resourceLabel: "Zone or DNS record",
  resourcePlaceholder: "acme.dev",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["api_token", "authorization", "content"],
  actions: [
    action("list_zones", "List zones", "GET", "/client/v4/zones", "read", "List zones on the account.", {
      sample: { result: [{ id: "9f2a", name: "acme.dev", status: "active" }] },
    }),
    action("get_zone", "Get zone", "GET", "/client/v4/zones/{id}", "read", "Read one zone.", {
      resourceLabel: "Zone",
      sample: { result: { id: "9f2a", name: "acme.dev", status: "active" } },
    }),
    action("list_dns_records", "List DNS records", "GET", "/client/v4/zones/{id}/dns_records", "read", "List DNS records in a zone.", {
      resourceLabel: "Zone",
      sample: { result: [{ id: "r1", type: "A", name: "app.acme.dev", content: "203.0.113.10" }] },
    }),
    action("create_dns_record", "Create DNS record", "POST", "/client/v4/zones/{id}/dns_records", "admin", "Create a DNS record. The approval screen shows the record before and after.", {
      resourceLabel: "Zone",
      fields: [
        { key: "type", label: "Type", placeholder: "A", required: true },
        { key: "name", label: "Name", placeholder: "app.acme.dev", required: true },
        { key: "content", label: "Content", placeholder: "203.0.113.11", required: true },
      ],
      sample: { result: { id: "r2", type: "A", name: "app.acme.dev", content: "203.0.113.11" } },
    }),
    action("update_dns_record", "Update DNS record", "PATCH", "/client/v4/zones/{id}/dns_records/{recordId}", "admin", "Change a DNS record. Can take a site offline.", {
      resourceLabel: "DNS record",
      fields: [{ key: "content", label: "Content", placeholder: "203.0.113.12" }],
      sample: { result: { id: "r1", content: "203.0.113.12" } },
    }),
    action("delete_dns_record", "Delete DNS record", "DELETE", "/client/v4/zones/{id}/dns_records/{recordId}", "destructive", "Delete a DNS record.", {
      resourceLabel: "DNS record",
      sample: { result: { id: "r1", deleted: true } },
    }),
    action("purge_cache", "Purge cache", "POST", "/client/v4/zones/{id}/purge_cache", "write", "Purge cached files or everything for a zone.", {
      resourceLabel: "Zone",
      fields: [{ key: "purge_everything", label: "Purge everything", placeholder: "true" }],
      sample: { result: { id: "9f2a", purged: true } },
    }),
    action("list_workers", "List Workers", "GET", "/client/v4/accounts/{account_id}/workers/scripts", "read", "List Workers scripts on the account.", {
      sample: { result: [{ id: "api-gateway", modified_on: "2026-10-28T10:00:00Z" }] },
    }),
    action("list_r2_buckets", "List R2 buckets", "GET", "/client/v4/accounts/{account_id}/r2/buckets", "read", "List R2 buckets on the account.", {
      sample: { buckets: [{ name: "agent-artifacts" }] },
    }),
    action("get_zone_analytics", "Zone analytics", "POST", "/client/v4/graphql", "read", "Query zone analytics through GraphQL.", {
      resourceLabel: "Zone",
      fields: [{ key: "query", label: "GraphQL query", placeholder: "query { viewer { zones { ... } } }" }],
      sample: { data: { viewer: { zones: [{ requests: 12842 }] } } },
    }),
    action("list_firewall_rules", "List firewall rules", "GET", "/client/v4/zones/{id}/firewall/rules", "read", "List firewall rules in a zone.", {
      resourceLabel: "Zone",
      sample: { result: [{ id: "fw1", description: "Block scrapers", action: "block" }] },
    }),
    action("create_firewall_rule", "Create firewall rule", "POST", "/client/v4/zones/{id}/firewall/rules", "admin", "Create a firewall rule.", {
      resourceLabel: "Zone",
      fields: [
        { key: "description", label: "Description", placeholder: "Block scrapers" },
        { key: "expression", label: "Expression", placeholder: "http.user_agent contains \"scraper\"", required: true },
        { key: "action", label: "Action", placeholder: "block" },
      ],
      sample: { result: [{ id: "fw2", description: "Block scrapers", action: "block" }] },
    }),
    action("delete_firewall_rule", "Delete firewall rule", "DELETE", "/client/v4/zones/{id}/firewall/rules/{ruleId}", "destructive", "Delete a firewall rule.", {
      resourceLabel: "Zone",
      sample: { result: [{ id: "fw2", deleted: true }] },
    }),
  ],
};

export default cloudflare;
