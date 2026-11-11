import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "figma";
const action = actionFactory(slug);

const figma: Connector = {
  slug,
  name: "Figma",
  category: "Productivity",
  description: "Read file trees, export images and manage comments in Figma files and projects.",
  color: "#F24E1E",
  mark: "FG",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "oauth", label: "Figma OAuth 2.0" },
    { type: "api_key", label: "Personal access token" },
  ],
  defaultAuth: "oauth",
  hosts: ["api.figma.com"],
  injection: { type: "header", name: "X-Figma-Token", field: "token" },
  oauthInjection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "access_token" },
  credentialFields: [
    {
      key: "token",
      label: "Personal access token",
      secret: true,
      required: true,
      placeholder: "figd_…",
      help: "OAuth is preferred; a personal token works for quick setup.",
    },
  ],
  scopes: [
    { value: "file_content:read", label: "Read file content" },
    { value: "file_comments:read", label: "Read comments" },
    { value: "file_comments:write", label: "Post and delete comments", optional: true },
    { value: "projects:read", label: "List projects and files", optional: true },
  ],
  resourceLabel: "File or project",
  resourcePlaceholder: "AbC123def",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["token", "x-figma-token", "client_meta"],
  actions: [
    action("get_file", "Get file", "GET", "/v1/files/{key}", "read", "Read a file tree with depth limiting.", {
      resourceLabel: "File",
      fields: [{ key: "depth", label: "Depth", placeholder: "2" }],
      sample: { name: "Agent dashboard", lastModified: "2026-10-30T10:00:00Z" },
    }),
    action("get_file_nodes", "Get file nodes", "GET", "/v1/files/{key}/nodes", "read", "Read specific nodes from a file.", {
      resourceLabel: "File",
      fields: [{ key: "ids", label: "Node IDs", placeholder: "1:2,1:3" }],
      sample: { nodes: { "1:2": { document: { name: "Header" } } } },
    }),
    action("get_images", "Export images", "GET", "/v1/images/{key}", "read", "Render nodes as PNG, SVG or PDF.", {
      resourceLabel: "File",
      fields: [
        { key: "ids", label: "Node IDs", placeholder: "1:2" },
        { key: "format", label: "Format", placeholder: "svg" },
      ],
      sample: { images: { "1:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/…" } },
    }),
    action("get_file_components", "Get components", "GET", "/v1/files/{key}/components", "read", "List components in a file.", {
      resourceLabel: "File",
      sample: { meta: { components: [{ name: "Button" }] } },
    }),
    action("get_file_styles", "Get styles", "GET", "/v1/files/{key}/styles", "read", "List styles in a file.", {
      resourceLabel: "File",
      sample: { meta: { styles: [{ name: "Ink/900" }] } },
    }),
    action("list_team_projects", "List team projects", "GET", "/v1/teams/{id}/projects", "read", "List projects in a team.", {
      resourceLabel: "Team",
      sample: { projects: [{ id: "77", name: "Agent surfaces" }] },
    }),
    action("list_project_files", "List project files", "GET", "/v1/projects/{id}/files", "read", "List files in a project.", {
      resourceLabel: "Project",
      sample: { files: [{ key: "AbC123def", name: "Agent dashboard" }] },
    }),
    action("list_comments", "List comments", "GET", "/v1/files/{key}/comments", "read", "List comments on a file.", {
      resourceLabel: "File",
      sample: { comments: [{ id: "c1", message: "Spacing looks off" }] },
    }),
    action("post_comment", "Post comment", "POST", "/v1/files/{key}/comments", "write", "Comment on a file.", {
      resourceLabel: "File",
      fields: [
        { key: "message", label: "Comment", placeholder: "Please review the empty state", required: true },
        { key: "node_id", label: "Node ID", placeholder: "1:2" },
      ],
      sample: { id: "c2", message: "Please review the empty state" },
    }),
    action("delete_comment", "Delete comment", "DELETE", "/v1/files/{key}/comments/{commentId}", "destructive", "Delete a comment.", {
      resourceLabel: "File",
      sample: { id: "c2", deleted: true },
    }),
    action("get_variables", "Get variables", "GET", "/v1/files/{key}/variables/local", "read", "Read local variables where the Figma plan supports it.", {
      resourceLabel: "File",
      sample: { meta: { variables: [{ name: "ink/900" }] } },
    }),
  ],
};

export default figma;
