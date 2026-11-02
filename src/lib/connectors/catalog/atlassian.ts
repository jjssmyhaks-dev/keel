import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "atlassian";
const action = actionFactory(slug);

const jira = "/ex/jira/{cloud_id}/rest/api/3";
const confluence = "/ex/confluence/{cloud_id}/wiki";

const atlassian: Connector = {
  slug,
  name: "Atlassian",
  category: "Productivity",
  description: "Read and change Jira issues and Confluence pages on one Atlassian Cloud site.",
  color: "#0052CC",
  mark: "AT",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Atlassian OAuth 2.0" }],
  defaultAuth: "oauth",
  hosts: ["api.atlassian.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "access_token" },
  credentialFields: [
    {
      key: "cloud_id",
      label: "Cloud ID",
      required: true,
      placeholder: "9f8e7d6c-…",
      help: "From GET /oauth/token/accessible-resources. Pins the connection to one site.",
    },
    {
      key: "access_token",
      label: "OAuth access token",
      secret: true,
      required: true,
      placeholder: "eyJ…",
      help: "Access tokens expire; reconnect through OAuth to refresh.",
    },
  ],
  scopes: [
    { value: "read:jira-work", label: "Read Jira projects, issues and comments" },
    { value: "write:jira-work", label: "Create, update and transition issues" },
    { value: "read:jira-user", label: "Read Jira users for assignee lookup" },
    { value: "read:confluence-content.all", label: "Read Confluence pages and spaces", optional: true },
    { value: "write:confluence-content", label: "Create and update Confluence pages", optional: true },
    { value: "offline_access", label: "Issue refresh tokens" },
  ],
  resourceLabel: "Project, issue, space or page",
  resourcePlaceholder: "ENG",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "body", "content"],
  actions: [
    action("search_issues", "Search issues", "GET", `${jira}/search/jql`, "read", "Search Jira issues with JQL and cursor paging.", {
      fields: [
        { key: "jql", label: "JQL", placeholder: "project = ENG AND status != Done" },
        { key: "maxResults", label: "Max results", placeholder: "25" },
      ],
      mock: { issues: [{ key: "ENG-482", fields: { summary: "Agent follow-up", status: "In progress" } }], nextPageToken: null },
    }),
    action("get_issue", "Get issue", "GET", `${jira}/issue/{key}`, "read", "Read one Jira issue.", {
      resourceLabel: "Issue",
      mock: { key: "ENG-482", fields: { summary: "Agent follow-up", status: "In progress" } },
    }),
    action("list_projects", "List projects", "GET", `${jira}/project/search`, "read", "List visible Jira projects.", {
      mock: { values: [{ key: "ENG", name: "Engineering" }] },
    }),
    action("create_issue", "Create issue", "POST", `${jira}/issue`, "write", "Create a Jira issue. Plain text or markdown is converted to Atlassian Document Format.", {
      fields: [
        { key: "projectKey", label: "Project key", placeholder: "ENG", required: true },
        { key: "summary", label: "Summary", placeholder: "Follow up on billing", required: true },
        { key: "description", label: "Description", placeholder: "Details…" },
        { key: "issueType", label: "Issue type", placeholder: "Task" },
      ],
      mock: { id: "10042", key: "ENG-483", self: `${jira}/issue/10042` },
    }),
    action("update_issue", "Update issue", "PUT", `${jira}/issue/{key}`, "write", "Edit fields on a Jira issue.", {
      resourceLabel: "Issue",
      fields: [{ key: "summary", label: "Summary", placeholder: "Updated summary" }],
      mock: { key: "ENG-482", updated: true },
    }),
    action("transition_issue", "Transition issue", "POST", `${jira}/issue/{key}/transitions`, "write", "Move an issue to another workflow status.", {
      resourceLabel: "Issue",
      fields: [{ key: "transitionId", label: "Transition ID", placeholder: "31", required: true }],
      mock: { key: "ENG-482", transitioned: true },
    }),
    action("add_comment", "Add comment", "POST", `${jira}/issue/{key}/comment`, "write", "Comment on a Jira issue.", {
      resourceLabel: "Issue",
      fields: [{ key: "body", label: "Comment", placeholder: "Deployed to staging", required: true }],
      mock: { id: "20031", body: "Deployed to staging" },
    }),
    action("assign_issue", "Assign issue", "PUT", `${jira}/issue/{key}/assignee`, "write", "Assign a Jira issue to an account ID.", {
      resourceLabel: "Issue",
      fields: [{ key: "accountId", label: "Account ID", placeholder: "5b10ac8d…", required: true }],
      mock: { key: "ENG-482", assigned: true },
    }),
    action("delete_issue", "Delete issue", "DELETE", `${jira}/issue/{key}`, "destructive", "Delete a Jira issue permanently.", {
      resourceLabel: "Issue",
      mock: { key: "ENG-482", deleted: true },
    }),
    action("search_content", "Search content", "GET", `${confluence}/rest/api/search`, "read", "Search Confluence pages with CQL.", {
      fields: [{ key: "cql", label: "CQL", placeholder: "space = ENG AND type = page" }],
      mock: { results: [{ content: { id: "98123", title: "Billing runbook" } }] },
    }),
    action("get_page", "Get page", "GET", `${confluence}/api/v2/pages/{id}`, "read", "Read one Confluence page.", {
      resourceLabel: "Page",
      mock: { id: "98123", title: "Billing runbook", version: { number: 4 } },
    }),
    action("list_spaces", "List spaces", "GET", `${confluence}/api/v2/spaces`, "read", "List Confluence spaces.", {
      mock: { results: [{ id: "771", key: "ENG", name: "Engineering" }] },
    }),
    action("create_page", "Create page", "POST", `${confluence}/api/v2/pages`, "write", "Create a Confluence page from plain text or markdown.", {
      fields: [
        { key: "spaceId", label: "Space ID", placeholder: "771", required: true },
        { key: "title", label: "Title", placeholder: "Incident notes", required: true },
        { key: "body", label: "Body", placeholder: "Markdown…" },
      ],
      mock: { id: "98124", title: "Incident notes", version: { number: 1 } },
    }),
    action("update_page", "Update page", "PUT", `${confluence}/api/v2/pages/{id}`, "write", "Update a page. The connector reads the current version first.", {
      resourceLabel: "Page",
      fields: [{ key: "body", label: "Body", placeholder: "Markdown…" }],
      mock: { id: "98123", version: { number: 5 } },
    }),
    action("delete_page", "Delete page", "DELETE", `${confluence}/api/v2/pages/{id}`, "destructive", "Delete a Confluence page.", {
      resourceLabel: "Page",
      mock: { id: "98123", deleted: true },
    }),
  ],
};

export default atlassian;
