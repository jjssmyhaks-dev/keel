import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "sentry";
const action = actionFactory(slug);

const sentry: Connector = {
  slug,
  name: "Sentry",
  category: "Developer",
  description: "Read and triage errors, events, releases and projects across your Sentry organizations.",
  color: "#362D59",
  mark: "SE",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "bearer", label: "Organization token" },
    { type: "oauth", label: "Sentry OAuth" },
  ],
  defaultAuth: "bearer",
  hosts: ["sentry.io", "*.sentry.io"],
  allowAnyPublicHost: true,
  baseUrlField: "base_url",
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
  credentialFields: [
    {
      key: "base_url",
      label: "Sentry host",
      required: true,
      placeholder: "https://sentry.io",
      help: "Use https://de.sentry.io for the EU region, or a public self-hosted URL that passes the SSRF checks.",
    },
    { key: "token", label: "Auth token", secret: true, required: true, placeholder: "sntrys_…" },
  ],
  scopes: [
    { value: "org:read", label: "Read organizations and projects" },
    { value: "event:read", label: "Read issues and events" },
    { value: "event:write", label: "Resolve, ignore and assign issues", optional: true },
    { value: "project:releases", label: "Read and create releases", optional: true },
  ],
  resourceLabel: "Project or issue",
  resourcePlaceholder: "acme/api",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["token", "authorization", "email", "ip_address", "request"],
  actions: [
    action("list_organizations", "List organizations", "GET", "/api/0/organizations/", "read", "List organizations the token can see.", {
      mock: [{ slug: "acme", name: "Acme", status: { id: "active" } }],
    }),
    action("list_projects", "List projects", "GET", "/api/0/projects/", "read", "List projects across accessible organizations.", {
      mock: [{ slug: "api", team: { slug: "platform" }, platform: "node" }],
    }),
    action("list_issues", "List issues", "GET", "/api/0/projects/{org}/{project}/issues/", "read", "List issues for a project.", {
      resourceLabel: "Project",
      fields: [{ key: "query", label: "Query", placeholder: "is:unresolved" }],
      mock: [{ id: "4512", title: "TypeError: undefined is not a function", level: "error" }],
    }),
    action("get_issue", "Get issue", "GET", "/api/0/issues/{id}/", "read", "Read one issue.", {
      resourceLabel: "Issue",
      mock: { id: "4512", title: "TypeError: undefined is not a function", status: "unresolved" },
    }),
    action("list_issue_events", "List issue events", "GET", "/api/0/issues/{id}/events/", "read", "List occurrences of an issue.", {
      resourceLabel: "Issue",
      mock: [{ eventID: "8f2a", message: "TypeError", user: { email: "[redacted]" } }],
    }),
    action("get_event", "Get event", "GET", "/api/0/projects/{org}/{project}/events/{eventId}/", "read", "Read one event with personal fields redacted by default.", {
      resourceLabel: "Project",
      mock: { eventID: "8f2a", message: "TypeError", user: { email: "[redacted]" } },
    }),
    action("update_issue", "Update issue", "PUT", "/api/0/issues/{id}/", "write", "Resolve, ignore or assign an issue.", {
      resourceLabel: "Issue",
      fields: [{ key: "status", label: "Status", placeholder: "resolved" }],
      mock: { id: "4512", status: "resolved" },
    }),
    action("list_releases", "List releases", "GET", "/api/0/organizations/{org}/releases/", "read", "List releases for an organization.", {
      resourceLabel: "Organization",
      mock: [{ version: "api@1.4.0", dateCreated: "2026-10-30T10:00:00Z" }],
    }),
    action("create_release", "Create release", "POST", "/api/0/organizations/{org}/releases/", "write", "Create a release marker.", {
      resourceLabel: "Organization",
      fields: [{ key: "version", label: "Version", placeholder: "api@1.5.0", required: true }],
      mock: { version: "api@1.5.0", dateCreated: "2026-11-02T09:00:00Z" },
    }),
    action("delete_issue", "Delete issue", "DELETE", "/api/0/issues/{id}/", "destructive", "Delete an issue and its events.", {
      resourceLabel: "Issue",
      mock: { id: "4512", deleted: true },
    }),
  ],
};

export default sentry;
