import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "discord";
const action = actionFactory(slug);

const discord: Connector = {
  slug,
  name: "Discord",
  category: "Communication",
  description: "Read channels and messages, post updates and manage threads in a Discord server.",
  color: "#5865F2",
  mark: "DC",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "api_key", label: "Bot token" }],
  defaultAuth: "api_key",
  hosts: ["discord.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bot ", field: "bot_token" },
  credentialFields: [
    { key: "bot_token", label: "Bot token", secret: true, required: true, placeholder: "MTIz…" },
    {
      key: "application_id",
      label: "Application ID",
      required: true,
      placeholder: "123456789012345678",
      help: "Used to generate the install link that adds the bot to a server.",
    },
  ],
  scopes: [
    { value: "bot", label: "Install the bot in a server" },
    { value: "messages:read", label: "Read channel messages" },
    { value: "messages:write", label: "Send, edit and delete messages" },
    { value: "moderation", label: "Kick and ban members", optional: true },
  ],
  resourceLabel: "Server or channel",
  resourcePlaceholder: "#agent-ops",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["bot_token", "authorization", "content"],
  actions: [
    action("list_guilds", "List servers", "GET", "/api/v10/users/@me/guilds", "read", "List servers the bot is installed in.", {
      mock: [{ id: "8123", name: "Acme Ops" }],
    }),
    action("list_channels", "List channels", "GET", "/api/v10/guilds/{id}/channels", "read", "List channels in a server.", {
      resourceLabel: "Server",
      mock: [{ id: "9123", name: "agent-ops", type: 0 }],
    }),
    action("get_messages", "Get messages", "GET", "/api/v10/channels/{id}/messages", "read", "Read recent messages. The message content intent must be enabled.", {
      resourceLabel: "Channel",
      mock: [{ id: "101", content: "Deploy finished", author: { username: "ci-bot" } }],
    }),
    action("send_message", "Send message", "POST", "/api/v10/channels/{id}/messages", "write", "Send a message. @everyone and @here are stripped unless the grant allows them.", {
      resourceLabel: "Channel",
      fields: [{ key: "content", label: "Message", placeholder: "Build 1842 deployed to staging", required: true }],
      mock: { id: "102", content: "Build 1842 deployed to staging" },
    }),
    action("edit_message", "Edit message", "PATCH", "/api/v10/channels/{id}/messages/{messageId}", "write", "Edit a message the bot posted.", {
      resourceLabel: "Channel",
      fields: [{ key: "content", label: "Message", placeholder: "Updated status", required: true }],
      mock: { id: "102", content: "Updated status" },
    }),
    action("delete_message", "Delete message", "DELETE", "/api/v10/channels/{id}/messages/{messageId}", "destructive", "Delete a message.", {
      resourceLabel: "Channel",
      mock: { id: "102", deleted: true },
    }),
    action("add_reaction", "Add reaction", "PUT", "/api/v10/channels/{id}/messages/{messageId}/reactions/{emoji}/@me", "write", "React to a message.", {
      resourceLabel: "Channel",
      fields: [{ key: "emoji", label: "Emoji", placeholder: "✅", required: true }],
      mock: { reacted: true },
    }),
    action("create_thread", "Create thread", "POST", "/api/v10/channels/{id}/threads", "write", "Start a thread from a message.", {
      resourceLabel: "Channel",
      fields: [
        { key: "name", label: "Thread name", placeholder: "Incident 1842", required: true },
        { key: "messageId", label: "Message ID", placeholder: "102" },
      ],
      mock: { id: "201", name: "Incident 1842" },
    }),
    action("list_members", "List members", "GET", "/api/v10/guilds/{id}/members", "read", "List server members. The members intent must be enabled.", {
      resourceLabel: "Server",
      mock: [{ user: { username: "ashif" }, roles: [] }],
    }),
    action("kick_member", "Kick member", "DELETE", "/api/v10/guilds/{id}/members/{userId}", "admin", "Kick a member. Disabled unless the customer enables it explicitly.", {
      resourceLabel: "Server",
      mock: { userId: "501", kicked: true },
    }),
    action("ban_member", "Ban member", "PUT", "/api/v10/guilds/{id}/bans/{userId}", "admin", "Ban a member. Disabled unless the customer enables it explicitly.", {
      resourceLabel: "Server",
      mock: { userId: "501", banned: true },
    }),
  ],
};

export default discord;
