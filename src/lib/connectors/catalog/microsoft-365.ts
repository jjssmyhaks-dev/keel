import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "microsoft-365";
const action = actionFactory(slug);

const microsoft365: Connector = {
  slug,
  name: "Microsoft 365",
  category: "Communication",
  description: "Work with Outlook mail and calendar, OneDrive files and Teams channels through Microsoft Graph.",
  color: "#D83B01",
  mark: "MS",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Microsoft Entra ID OAuth" }],
  defaultAuth: "oauth",
  hosts: ["graph.microsoft.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "access_token" },
  credentialFields: [
    {
      key: "access_token",
      label: "Delegated access token",
      secret: true,
      required: true,
      placeholder: "eyJ…",
      help: "Delegated permissions only. Some scopes need tenant administrator consent.",
    },
  ],
  scopes: [
    { value: "User.Read", label: "Read the signed-in profile" },
    { value: "Mail.Read", label: "Read mail", optional: true },
    { value: "Mail.Send", label: "Send mail", optional: true },
    { value: "Mail.ReadWrite", label: "Draft and delete mail", optional: true },
    { value: "Calendars.ReadWrite", label: "Read and change calendar events", optional: true },
    { value: "Files.ReadWrite", label: "Read and change OneDrive files", optional: true },
    { value: "Chat.ReadWrite", label: "Read and send chats", optional: true },
    { value: "ChannelMessage.Send", label: "Post channel messages", optional: true },
    { value: "Team.ReadBasic.All", label: "List joined teams", optional: true },
    { value: "offline_access", label: "Issue refresh tokens" },
  ],
  resourceLabel: "Mailbox, event, file or team channel",
  resourcePlaceholder: "user@acme.onmicrosoft.com",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "body", "subject", "toRecipients"],
  actions: [
    action("list_messages", "List messages", "GET", "/v1.0/me/messages", "read", "List mailbox messages with filter and search.", {
      fields: [
        { key: "$filter", label: "Filter", placeholder: "isRead eq false" },
        { key: "$search", label: "Search", placeholder: "\"invoice\"" },
      ],
      mock: { value: [{ id: "AAMk1", subject: "[redacted]", from: { emailAddress: { address: "[redacted]" } } }] },
    }),
    action("get_message", "Get message", "GET", "/v1.0/me/messages/{id}", "read", "Read one message. Bodies are redacted by default.", {
      resourceLabel: "Message",
      mock: { id: "AAMk1", subject: "[redacted]", body: { content: "[redacted]" } },
    }),
    action("create_draft", "Create draft", "POST", "/v1.0/me/messages", "write", "Create a draft message.", {
      fields: [
        { key: "to", label: "To", placeholder: "ops@acme.dev", required: true },
        { key: "subject", label: "Subject", placeholder: "Weekly status", required: true },
        { key: "body", label: "Body", placeholder: "All good." },
      ],
      mock: { id: "AAMk2", isDraft: true },
    }),
    action("send_mail", "Send mail", "POST", "/v1.0/me/sendMail", "write", "Send mail. External recipients require approval by default.", {
      fields: [
        { key: "to", label: "To", placeholder: "ops@acme.dev", required: true },
        { key: "subject", label: "Subject", placeholder: "Weekly status", required: true },
        { key: "body", label: "Body", placeholder: "All good." },
      ],
      mock: { accepted: true },
    }),
    action("reply_to_message", "Reply to message", "POST", "/v1.0/me/messages/{id}/reply", "write", "Reply to a message.", {
      resourceLabel: "Message",
      fields: [{ key: "comment", label: "Reply", placeholder: "Thanks, looking now.", required: true }],
      mock: { accepted: true },
    }),
    action("delete_message", "Delete message", "DELETE", "/v1.0/me/messages/{id}", "destructive", "Delete a message.", {
      resourceLabel: "Message",
      mock: { id: "AAMk1", deleted: true },
    }),
    action("list_events", "List events", "GET", "/v1.0/me/events", "read", "List calendar events.", {
      mock: { value: [{ id: "AAMk3", subject: "[redacted]", start: { dateTime: "2026-11-03T10:00:00" } }] },
    }),
    action("create_event", "Create event", "POST", "/v1.0/me/events", "write", "Create a calendar event.", {
      fields: [
        { key: "subject", label: "Subject", placeholder: "Agent review", required: true },
        { key: "start", label: "Start", placeholder: "2026-11-03T10:00:00" },
        { key: "end", label: "End", placeholder: "2026-11-03T10:30:00" },
      ],
      mock: { id: "AAMk4", subject: "Agent review" },
    }),
    action("update_event", "Update event", "PATCH", "/v1.0/me/events/{id}", "write", "Change a calendar event.", {
      resourceLabel: "Event",
      fields: [{ key: "subject", label: "Subject", placeholder: "Agent review (moved)" }],
      mock: { id: "AAMk4", subject: "Agent review (moved)" },
    }),
    action("delete_event", "Delete event", "DELETE", "/v1.0/me/events/{id}", "destructive", "Delete a calendar event.", {
      resourceLabel: "Event",
      mock: { id: "AAMk4", deleted: true },
    }),
    action("list_drive_items", "List drive items", "GET", "/v1.0/me/drive/root/children", "read", "List files and folders in the drive root.", {
      mock: { value: [{ id: "01X", name: "runbook.md", size: 4210 }] },
    }),
    action("download_file", "Download file", "GET", "/v1.0/me/drive/items/{id}/content", "read", "Download a file with a size cap.", {
      resourceLabel: "File",
      mock: { content: "redacted file content", size: 4210 },
    }),
    action("upload_file", "Upload file", "PUT", "/v1.0/me/drive/root:/{path}:/content", "write", "Upload a file. Files over 4 MB need an upload session.", {
      fields: [{ key: "content", label: "Content", placeholder: "File contents", required: true }],
      mock: { id: "01Y", name: "notes.md", size: 312 },
    }),
    action("delete_drive_item", "Delete drive item", "DELETE", "/v1.0/me/drive/items/{id}", "destructive", "Delete a file or folder.", {
      resourceLabel: "File",
      mock: { id: "01X", deleted: true },
    }),
    action("list_teams", "List teams", "GET", "/v1.0/me/joinedTeams", "read", "List joined Teams.", {
      mock: { value: [{ id: "team1", displayName: "Platform" }] },
    }),
    action("send_channel_message", "Send channel message", "POST", "/v1.0/teams/{id}/channels/{channelId}/messages", "write", "Post a message in a Teams channel.", {
      resourceLabel: "Channel",
      fields: [{ key: "content", label: "Message", placeholder: "Deploy finished", required: true }],
      mock: { id: "msg1", webUrl: "https://teams.microsoft.com/…" },
    }),
  ],
};

export default microsoft365;
