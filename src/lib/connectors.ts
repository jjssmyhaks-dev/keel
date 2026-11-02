import { EXTRA_CONNECTORS } from "./connectors/catalog";

export type Risk = "read" | "write" | "destructive" | "financial" | "admin";
export type AuthMethod = "oauth" | "api_key" | "bearer" | "basic";

export type CredentialField = {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  help?: string;
};

export type ConnectorInjection = {
  type: "header" | "query";
  name: string;
  prefix?: string;
  field?: string;
  basic?: { usernameField: string; passwordField: string };
  extraHeaders?: { name: string; field?: string; value?: string; prefix?: string }[];
  queryParams?: { name: string; field?: string; value?: string }[];
};

export type ConnectorAction = {
  name: string;
  label: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  risk: Risk;
  resourceLabel?: string;
  host?: string;
  hostTemplate?: string;
  baseUrlField?: string;
  authField?: string;
  extraHeaders?: ConnectorInjection["extraHeaders"];
  queryParams?: ConnectorInjection["queryParams"];
  fields?: { key: string; label: string; placeholder?: string; required?: boolean }[];
  mock?: unknown;
};

export type Connector = {
  slug: string;
  name: string;
  category: string;
  description: string;
  color: string;
  mark: string;
  docsUrl: string;
  authMethods: { type: AuthMethod; label: string }[];
  defaultAuth: AuthMethod;
  hosts: string[];
  injection: ConnectorInjection;
  credentialFields?: CredentialField[];
  requireAnyFields?: string[];
  baseUrlField?: string;
  hostTemplate?: string;
  allowAnyPublicHost?: boolean;
  authStrategy?: "snowflake-jwt";
  bodyParams?: { name: string; field: string }[];
  scopes: { value: string; label: string; optional?: boolean }[];
  resourceLabel: string;
  resourcePlaceholder: string;
  actions: ConnectorAction[];
  status: "stable" | "beta";
  version: string;
  redactedFields: string[];
};

const base = "https://keel.dev/docs/connectors";

export const CONNECTORS: Connector[] = [
  {
    slug: "slack",
    name: "Slack",
    category: "Communication",
    description: "Post messages, read channels and upload files on behalf of your agents.",
    color: "#4A154B",
    mark: "SL",
    docsUrl: `${base}/slack`,
    authMethods: [
      { type: "oauth", label: "OAuth 2.0 (recommended)" },
      { type: "bearer", label: "Bot token" },
    ],
    defaultAuth: "oauth",
    hosts: ["slack.com", "api.slack.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "channels:read", label: "See the list of channels in your workspace" },
      { value: "chat:write", label: "Send messages as the connected app" },
      { value: "files:write", label: "Upload files to channels" },
      { value: "users:read", label: "Read member profiles", optional: true },
    ],
    resourceLabel: "Channel",
    resourcePlaceholder: "support-*",
    status: "stable",
    version: "2.1.0",
    redactedFields: ["token", "authorization", "text"],
    actions: [
      {
        name: "slack.post_message",
        label: "Post message",
        description: "Send a message to a channel.",
        method: "POST",
        path: "/api/chat.postMessage",
        risk: "write",
        resourceLabel: "Channel",
        fields: [
          { key: "channel", label: "Channel", placeholder: "#support", required: true },
          { key: "text", label: "Message", placeholder: "Summarize of the latest escalation…", required: true },
        ],
        mock: { ok: true, channel: "C08SUPPORT", ts: "1730563200.481516" },
      },
      {
        name: "slack.list_channels",
        label: "List channels",
        description: "List public channels visible to the connection.",
        method: "GET",
        path: "/api/conversations.list",
        risk: "read",
        mock: {
          ok: true,
          channels: [
            { id: "C08SUPPORT", name: "support" },
            { id: "C08ENG", name: "engineering" },
            { id: "C08LAUNCH", name: "launch-room" },
          ],
        },
      },
      {
        name: "slack.read_channel",
        label: "Read channel history",
        description: "Read the most recent messages in a channel.",
        method: "GET",
        path: "/api/conversations.history",
        risk: "read",
        resourceLabel: "Channel",
        mock: {
          ok: true,
          messages: [{ user: "U08ALEX", text: "Can someone check the billing webhook?", ts: "1730562900.1" }],
        },
      },
      {
        name: "slack.upload_file",
        label: "Upload file",
        description: "Upload a file to a channel.",
        method: "POST",
        path: "/api/files.upload",
        risk: "write",
        resourceLabel: "Channel",
        mock: { ok: true, file: { id: "F08REPORT", name: "weekly-report.pdf" } },
      },
    ],
  },
  {
    slug: "github",
    name: "GitHub",
    category: "Developer",
    description: "Work with repositories, issues and pull requests with least-privilege scopes.",
    color: "#111111",
    mark: "GH",
    docsUrl: `${base}/github`,
    authMethods: [
      { type: "oauth", label: "OAuth 2.0 (GitHub App)" },
      { type: "api_key", label: "Fine-grained personal access token" },
    ],
    defaultAuth: "oauth",
    hosts: ["api.github.com", "github.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "repo:read", label: "Read repository contents and metadata" },
      { value: "issues:write", label: "Create and comment on issues" },
      { value: "pull_requests:write", label: "Comment on and merge pull requests" },
      { value: "actions:read", label: "Read workflow runs", optional: true },
    ],
    resourceLabel: "Repository",
    resourcePlaceholder: "acme/checkout-*",
    status: "stable",
    version: "3.0.2",
    redactedFields: ["token", "authorization", "body"],
    actions: [
      {
        name: "github.create_issue",
        label: "Create issue",
        description: "Open a new issue in a repository.",
        method: "POST",
        path: "/repos/{owner}/{repo}/issues",
        risk: "write",
        resourceLabel: "Repository",
        fields: [
          { key: "repo", label: "Repository", placeholder: "acme/checkout", required: true },
          { key: "title", label: "Title", placeholder: "Checkout latency spike", required: true },
        ],
        mock: { id: 24819235, number: 142, state: "open", html_url: "https://github.com/acme/checkout/issues/142" },
      },
      {
        name: "github.list_repos",
        label: "List repositories",
        description: "List repositories the installation can access.",
        method: "GET",
        path: "/installation/repositories",
        risk: "read",
        mock: {
          total_count: 3,
          repositories: [
            { full_name: "acme/checkout", private: true },
            { full_name: "acme/billing", private: true },
            { full_name: "acme/docs", private: false },
          ],
        },
      },
      {
        name: "github.comment_issue",
        label: "Comment on issue",
        description: "Add a comment to an existing issue.",
        method: "POST",
        path: "/repos/{owner}/{repo}/issues/{number}/comments",
        risk: "write",
        resourceLabel: "Repository",
        mock: { id: 991823, body: "On it — the fix is rolling out in the next deploy." },
      },
      {
        name: "github.merge_pull_request",
        label: "Merge pull request",
        description: "Merge a pull request into its base branch.",
        method: "PUT",
        path: "/repos/{owner}/{repo}/pulls/{number}/merge",
        risk: "destructive",
        resourceLabel: "Repository",
        mock: { merged: true, message: "Pull Request successfully merged and closed" },
      },
    ],
  },
  {
    slug: "google",
    name: "Google Workspace",
    category: "Productivity",
    description: "Gmail, Calendar and Drive through one verified OAuth connection.",
    color: "#1A73E8",
    mark: "GW",
    docsUrl: `${base}/google-workspace`,
    authMethods: [
      { type: "oauth", label: "OAuth 2.0 with PKCE" },
      { type: "api_key", label: "Service account (enterprise)" },
    ],
    defaultAuth: "oauth",
    hosts: ["gmail.googleapis.com", "www.googleapis.com", "www.google.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "gmail.readonly", label: "Read email messages and threads" },
      { value: "gmail.send", label: "Send email on the user's behalf" },
      { value: "calendar.readonly", label: "Read calendar events", optional: true },
      { value: "calendar.events", label: "Create and edit calendar events", optional: true },
      { value: "drive.file", label: "Access files this app creates or opens", optional: true },
    ],
    resourceLabel: "Mailbox",
    resourcePlaceholder: "support@acme.com",
    status: "stable",
    version: "1.8.0",
    redactedFields: ["token", "authorization", "raw", "body", "subject"],
    actions: [
      {
        name: "gmail.send_message",
        label: "Send email",
        description: "Send an email from the connected mailbox.",
        method: "POST",
        path: "/gmail/v1/users/me/messages/send",
        risk: "write",
        resourceLabel: "Mailbox",
        fields: [
          { key: "to", label: "To", placeholder: "client@example.com", required: true },
          { key: "subject", label: "Subject", placeholder: "Your support ticket is resolved", required: true },
          { key: "body", label: "Body", placeholder: "Hi there, …", required: true },
        ],
        mock: { id: "18c2b7f9a1d24e6b", threadId: "18c2b7f9a1d24e6b", labelIds: ["SENT"] },
      },
      {
        name: "gmail.list_messages",
        label: "Search email",
        description: "Search the mailbox with a Gmail query.",
        method: "GET",
        path: "/gmail/v1/users/me/messages",
        risk: "read",
        resourceLabel: "Mailbox",
        mock: {
          resultSizeEstimate: 2,
          messages: [
            { id: "18c2b7f9a1d24e6b", threadId: "18c2b7f9a1d24e6b" },
            { id: "18c2b7f9a1d24e70", threadId: "18c2b7f9a1d24e70" },
          ],
        },
      },
      {
        name: "gmail.read_message",
        label: "Read email",
        description: "Read a single email message.",
        method: "GET",
        path: "/gmail/v1/users/me/messages/{id}",
        risk: "read",
        resourceLabel: "Mailbox",
        mock: {
          id: "18c2b7f9a1d24e6b",
          snippet: "Thanks for the quick turnaround — everything works now.",
          labelIds: ["INBOX"],
        },
      },
      {
        name: "gmail.create_draft",
        label: "Create draft",
        description: "Draft an email without sending it.",
        method: "POST",
        path: "/gmail/v1/users/me/drafts",
        risk: "write",
        resourceLabel: "Mailbox",
        mock: { id: "r-918234", message: { id: "18c2c01fd9a11b2f" } },
      },
      {
        name: "drive.create_file",
        label: "Create Drive file",
        description: "Create a document in Google Drive.",
        method: "POST",
        path: "/drive/v3/files",
        risk: "write",
        resourceLabel: "Folder",
        mock: { id: "1Kx9pQ2", name: "Weekly agent report", mimeType: "application/vnd.google-apps.document" },
      },
      {
        name: "calendar.create_event",
        label: "Create calendar event",
        description: "Add an event to the connected calendar.",
        method: "POST",
        path: "/calendar/v3/calendars/primary/events",
        risk: "write",
        resourceLabel: "Calendar",
        mock: { id: "evt_8f2a91", htmlLink: "https://calendar.google.com/event?eid=8f2a91", status: "confirmed" },
      },
    ],
  },
  {
    slug: "notion",
    name: "Notion",
    category: "Productivity",
    description: "Read and write pages and databases in a Notion workspace.",
    color: "#1F1F1F",
    mark: "NO",
    docsUrl: `${base}/notion`,
    authMethods: [{ type: "oauth", label: "OAuth 2.0" }],
    defaultAuth: "oauth",
    hosts: ["api.notion.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "read_content", label: "Read pages and databases shared with the integration" },
      { value: "insert_content", label: "Create and append content" },
      { value: "update_content", label: "Update existing pages and databases", optional: true },
    ],
    resourceLabel: "Page or database",
    resourcePlaceholder: "Engineering wiki",
    status: "stable",
    version: "1.4.1",
    redactedFields: ["token", "authorization", "content"],
    actions: [
      {
        name: "notion.create_page",
        label: "Create page",
        description: "Create a page inside a database or parent page.",
        method: "POST",
        path: "/v1/pages",
        risk: "write",
        resourceLabel: "Page or database",
        mock: { object: "page", id: "8a4c9f2e-91c2-4e7a-b39c-1d2a0e5f6a71", url: "https://notion.so/8a4c9f2e" },
      },
      {
        name: "notion.search",
        label: "Search workspace",
        description: "Search pages and databases by title.",
        method: "POST",
        path: "/v1/search",
        risk: "read",
        mock: {
          results: [
            { object: "page", id: "8a4c9f2e", properties: { title: "Agent runbook" } },
            { object: "database", id: "b1c2d3e4", title: "Incident log" },
          ],
        },
      },
      {
        name: "notion.append_block",
        label: "Append content",
        description: "Append blocks to a page.",
        method: "PATCH",
        path: "/v1/blocks/{id}/children",
        risk: "write",
        resourceLabel: "Page or database",
        mock: { object: "list", results: [{ object: "block", type: "paragraph" }] },
      },
      {
        name: "notion.update_page",
        label: "Update page",
        description: "Update page properties such as status or owner.",
        method: "PATCH",
        path: "/v1/pages/{id}",
        risk: "write",
        resourceLabel: "Page or database",
        mock: { object: "page", id: "8a4c9f2e", last_edited_time: "2026-10-30T16:12:00.000Z" },
      },
    ],
  },
  {
    slug: "hubspot",
    name: "HubSpot",
    category: "Commerce",
    description: "Contacts, deals and engagements with scoped CRM access.",
    color: "#FF7A59",
    mark: "HS",
    docsUrl: `${base}/hubspot`,
    authMethods: [{ type: "oauth", label: "OAuth 2.0" }],
    defaultAuth: "oauth",
    hosts: ["api.hubapi.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "crm.objects.contacts.read", label: "Read contacts" },
      { value: "crm.objects.contacts.write", label: "Create and update contacts" },
      { value: "crm.objects.deals.read", label: "Read deals", optional: true },
      { value: "crm.objects.deals.write", label: "Update deals", optional: true },
    ],
    resourceLabel: "CRM object",
    resourcePlaceholder: "contacts/*",
    status: "stable",
    version: "2.0.0",
    redactedFields: ["token", "authorization", "email"],
    actions: [
      {
        name: "hubspot.create_contact",
        label: "Create contact",
        description: "Create a CRM contact.",
        method: "POST",
        path: "/crm/v3/objects/contacts",
        risk: "write",
        resourceLabel: "CRM object",
        mock: { id: "5128491", properties: { email: "client@example.com", lifecycleStage: "lead" } },
      },
      {
        name: "hubspot.list_contacts",
        label: "List contacts",
        description: "List contacts with cursor pagination.",
        method: "GET",
        path: "/crm/v3/objects/contacts",
        risk: "read",
        mock: { total: 2, results: [{ id: "5128491" }, { id: "5128492" }] },
      },
      {
        name: "hubspot.update_deal",
        label: "Update deal",
        description: "Change deal stage or amount.",
        method: "PATCH",
        path: "/crm/v3/objects/deals/{id}",
        risk: "write",
        resourceLabel: "CRM object",
        mock: { id: "880192", properties: { dealstage: "closedwon" } },
      },
    ],
  },
  {
    slug: "stripe",
    name: "Stripe",
    category: "Commerce",
    description: "Payments and refunds. Every financial action requires approval in production.",
    color: "#635BFF",
    mark: "ST",
    docsUrl: `${base}/stripe`,
    authMethods: [
      { type: "api_key", label: "Restricted API key (recommended)" },
      { type: "oauth", label: "Stripe Connect OAuth" },
    ],
    defaultAuth: "api_key",
    hosts: ["api.stripe.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "charges:read", label: "Read charges and payment intents" },
      { value: "refunds:write", label: "Create refunds" },
      { value: "customers:read", label: "Read customer records", optional: true },
      { value: "payment_links:write", label: "Create payment links", optional: true },
    ],
    resourceLabel: "Account",
    resourcePlaceholder: "acct_*",
    status: "stable",
    version: "4.2.0",
    redactedFields: ["token", "authorization", "card", "number"],
    actions: [
      {
        name: "stripe.create_refund",
        label: "Create refund",
        description: "Refund a charge, in full or in part.",
        method: "POST",
        path: "/v1/refunds",
        risk: "financial",
        resourceLabel: "Account",
        fields: [
          { key: "charge", label: "Charge ID", placeholder: "ch_3Qx…", required: true },
          { key: "amount", label: "Amount (minor units)", placeholder: "4200" },
        ],
        mock: { id: "re_3Qx9a2Lk", object: "refund", status: "succeeded", amount: 4200, currency: "usd" },
      },
      {
        name: "stripe.list_charges",
        label: "List charges",
        description: "List recent charges.",
        method: "GET",
        path: "/v1/charges",
        risk: "read",
        mock: {
          object: "list",
          data: [
            { id: "ch_3Qx9a2", amount: 4200, currency: "usd", status: "succeeded" },
            { id: "ch_3Qx9a1", amount: 1800, currency: "usd", status: "succeeded" },
          ],
        },
      },
      {
        name: "stripe.create_payment_link",
        label: "Create payment link",
        description: "Create a shareable payment link.",
        method: "POST",
        path: "/v1/payment_links",
        risk: "financial",
        mock: { id: "plink_1Qx", url: "https://buy.stripe.com/test_abc123", active: true },
      },
      {
        name: "stripe.list_customers",
        label: "List customers",
        description: "List customer records.",
        method: "GET",
        path: "/v1/customers",
        risk: "read",
        mock: { object: "list", data: [{ id: "cus_Qx91" }, { id: "cus_Qx92" }] },
      },
    ],
  },
  {
    slug: "openai",
    name: "OpenAI",
    category: "AI & data",
    description: "Model calls with per-agent spend caps and token accounting.",
    color: "#10A37F",
    mark: "OA",
    docsUrl: `${base}/openai`,
    authMethods: [{ type: "api_key", label: "Project API key" }],
    defaultAuth: "api_key",
    hosts: ["api.openai.com"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "models:read", label: "List available models" },
      { value: "responses:write", label: "Run model completions" },
      { value: "embeddings:write", label: "Create embeddings", optional: true },
    ],
    resourceLabel: "Model",
    resourcePlaceholder: "gpt-4.1-mini",
    status: "stable",
    version: "1.9.0",
    redactedFields: ["token", "authorization", "input", "messages"],
    actions: [
      {
        name: "openai.chat_completion",
        label: "Chat completion",
        description: "Run a chat completion against a model.",
        method: "POST",
        path: "/v1/chat/completions",
        risk: "financial",
        resourceLabel: "Model",
        fields: [
          { key: "model", label: "Model", placeholder: "gpt-4.1-mini", required: true },
          { key: "messages", label: "Messages", placeholder: "Summarize this thread" },
        ],
        mock: {
          id: "chatcmpl-9x2kf",
          object: "chat.completion",
          model: "gpt-4.1-mini",
          choices: [{ index: 0, message: { role: "assistant", content: "Here is the summary you asked for." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 812, completion_tokens: 143, total_tokens: 955 },
        },
      },
      {
        name: "openai.list_models",
        label: "List models",
        description: "List models available to the project.",
        method: "GET",
        path: "/v1/models",
        risk: "read",
        mock: { object: "list", data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }] },
      },
      {
        name: "openai.create_embedding",
        label: "Create embedding",
        description: "Create a vector embedding.",
        method: "POST",
        path: "/v1/embeddings",
        risk: "financial",
        mock: { object: "list", data: [{ embedding: [0.0023, -0.0132], index: 0 }], usage: { prompt_tokens: 12, total_tokens: 12 } },
      },
    ],
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    category: "AI & data",
    description: "Claude model calls governed by spend caps and approval policies.",
    color: "#D97757",
    mark: "AN",
    docsUrl: `${base}/anthropic`,
    authMethods: [{ type: "api_key", label: "Workspace API key" }],
    defaultAuth: "api_key",
    hosts: ["api.anthropic.com"],
    injection: { type: "header", name: "x-api-key" },
    scopes: [
      { value: "messages:write", label: "Create messages with Claude" },
      { value: "models:read", label: "List available models", optional: true },
    ],
    resourceLabel: "Model",
    resourcePlaceholder: "claude-sonnet-4-5",
    status: "stable",
    version: "1.3.0",
    redactedFields: ["token", "x-api-key", "content", "messages"],
    actions: [
      {
        name: "anthropic.messages",
        label: "Create message",
        description: "Send a message to Claude.",
        method: "POST",
        path: "/v1/messages",
        risk: "financial",
        resourceLabel: "Model",
        fields: [
          { key: "model", label: "Model", placeholder: "claude-sonnet-4-5", required: true },
          { key: "max_tokens", label: "Max tokens", placeholder: "1024" },
        ],
        mock: {
          id: "msg_01Xy2",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "Here is the analysis." }],
          usage: { input_tokens: 624, output_tokens: 289 },
        },
      },
      {
        name: "anthropic.models",
        label: "List models",
        description: "List Claude models available to the workspace.",
        method: "GET",
        path: "/v1/models",
        risk: "read",
        mock: { data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }] },
      },
    ],
  },
  {
    slug: "linear",
    name: "Linear",
    category: "Developer",
    description: "Create and triage issues in Linear teams.",
    color: "#5E6AD2",
    mark: "LN",
    docsUrl: `${base}/linear`,
    authMethods: [{ type: "oauth", label: "OAuth 2.0" }],
    defaultAuth: "oauth",
    hosts: ["api.linear.app"],
    injection: { type: "header", name: "Authorization", prefix: "Bearer " },
    scopes: [
      { value: "issues:read", label: "Read issues" },
      { value: "issues:write", label: "Create and update issues" },
      { value: "projects:read", label: "Read projects", optional: true },
    ],
    resourceLabel: "Team",
    resourcePlaceholder: "ENG",
    status: "beta",
    version: "0.9.0",
    redactedFields: ["token", "authorization"],
    actions: [
      {
        name: "linear.create_issue",
        label: "Create issue",
        description: "Create an issue in a team.",
        method: "POST",
        path: "/graphql",
        risk: "write",
        resourceLabel: "Team",
        mock: { data: { issueCreate: { success: true, issue: { identifier: "ENG-482", title: "Agent follow-up" } } } },
      },
      {
        name: "linear.list_issues",
        label: "List issues",
        description: "List issues for a team.",
        method: "POST",
        path: "/graphql",
        risk: "read",
        mock: { data: { issues: { nodes: [{ identifier: "ENG-481", state: "In progress" }] } } },
      },
    ],
  },
  ...EXTRA_CONNECTORS,
];

export const CONNECTOR_MAP = Object.fromEntries(CONNECTORS.map((c) => [c.slug, c]));

export const RISK_META: Record<Risk, { label: string; description: string; color: string }> = {
  read: { label: "Read", description: "Read-only access. Auto-allowed by default.", color: "#2F7D5C" },
  write: { label: "Write", description: "Creates or changes data. Approval in production by default.", color: "#A56B18" },
  destructive: { label: "Destructive", description: "Deletes or merges. Always review before allowing.", color: "#B3402F" },
  financial: { label: "Financial", description: "Moves money or spends credits. Approval required.", color: "#7A3DB8" },
  admin: { label: "Admin", description: "Changes access, configuration or infrastructure. Approval required.", color: "#25567A" },
};

export function connector(slug: string) {
  return CONNECTOR_MAP[slug];
}

export function actionFor(slug: string, actionName: string) {
  return connector(slug)?.actions.find((a) => a.name === actionName);
}

export function allActions(slug: string) {
  return connector(slug)?.actions ?? [];
}

export function defaultModeForRisk(risk: Risk, environmentType: string) {
  if (environmentType === "development") {
    return risk === "read" || risk === "write" ? "allow" : "require_approval";
  }
  return risk === "read" ? "allow" : "require_approval";
}
