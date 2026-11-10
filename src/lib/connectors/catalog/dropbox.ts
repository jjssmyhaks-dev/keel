import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "dropbox";
const action = actionFactory(slug);

const dropbox: Connector = {
  slug,
  name: "Dropbox",
  category: "Productivity",
  description: "List, search, upload, move and share files in a Dropbox folder prefix.",
  color: "#0061FF",
  mark: "DB",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Dropbox OAuth 2.0 (PKCE)" }],
  defaultAuth: "oauth",
  hosts: ["api.dropboxapi.com", "content.dropboxapi.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "access_token" },
  credentialFields: [
    {
      key: "access_token",
      label: "OAuth access token",
      secret: true,
      required: true,
      placeholder: "sl.…",
      help: "Offline access must be requested so the connection can refresh.",
    },
  ],
  scopes: [
    { value: "files.content.read", label: "List, search and download files" },
    { value: "files.content.write", label: "Upload, move and copy files", optional: true },
    { value: "files.metadata.read", label: "Read file metadata" },
    { value: "sharing.write", label: "Create and revoke shared links", optional: true },
  ],
  resourceLabel: "Path",
  resourcePlaceholder: "/Agents/run-1842",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "path"],
  actions: [
    action("list_folder", "List folder", "POST", "/2/files/list_folder", "read", "List a folder. Paths are normalized to stop traversal.", {
      fields: [{ key: "path", label: "Folder path", placeholder: "/Agents", required: true }],
      sample: { entries: [{ ".tag": "file", name: "run-1842.json", path_display: "/Agents/run-1842.json" }], has_more: false },
    }),
    action("list_folder_continue", "Continue listing", "POST", "/2/files/list_folder/continue", "read", "Continue a folder listing with a cursor.", {
      fields: [{ key: "cursor", label: "Cursor", placeholder: "AAH…", required: true }],
      sample: { entries: [], has_more: false },
    }),
    action("get_metadata", "Get metadata", "POST", "/2/files/get_metadata", "read", "Read metadata for a path.", {
      resourceLabel: "Path",
      fields: [{ key: "path", label: "Path", placeholder: "/Agents/run-1842.json", required: true }],
      sample: { ".tag": "file", name: "run-1842.json", size: 4210 },
    }),
    action("search", "Search", "POST", "/2/files/search_v2", "read", "Search files and folders.", {
      fields: [{ key: "query", label: "Query", placeholder: "run-1842" }],
      sample: { matches: [{ metadata: { metadata: { name: "run-1842.json" } } }] },
    }),
    action("download_file", "Download file", "POST", "/2/files/download", "read", "Download a file with a size cap.", {
      host: "content.dropboxapi.com",
      argHeader: { name: "Dropbox-API-Arg" },
      resourceLabel: "Path",
      fields: [{ key: "path", label: "Path", placeholder: "/Agents/run-1842.json", required: true }],
      sample: { content: "redacted file content", size: 4210 },
    }),
    action("upload_file", "Upload file", "POST", "/2/files/upload", "write", "Upload a file up to 150 MB. Larger files use an upload session.", {
      host: "content.dropboxapi.com",
      argHeader: { name: "Dropbox-API-Arg", bodyField: "content" },
      resourceLabel: "Path",
      fields: [
        { key: "path", label: "Path", placeholder: "/Agents/run-1843.json", required: true },
        { key: "content", label: "Content", placeholder: "File contents", required: true },
      ],
      sample: { name: "run-1843.json", size: 312 },
    }),
    action("create_folder", "Create folder", "POST", "/2/files/create_folder_v2", "write", "Create a folder.", {
      resourceLabel: "Path",
      fields: [{ key: "path", label: "Path", placeholder: "/Agents/2026-11", required: true }],
      sample: { metadata: { name: "2026-11", path_display: "/Agents/2026-11" } },
    }),
    action("move", "Move", "POST", "/2/files/move_v2", "write", "Move a file or folder.", {
      resourceLabel: "Path",
      fields: [
        { key: "from_path", label: "From", placeholder: "/Agents/draft.json", required: true },
        { key: "to_path", label: "To", placeholder: "/Agents/final.json", required: true },
      ],
      sample: { metadata: { name: "final.json", path_display: "/Agents/final.json" } },
    }),
    action("copy", "Copy", "POST", "/2/files/copy_v2", "write", "Copy a file or folder.", {
      resourceLabel: "Path",
      fields: [
        { key: "from_path", label: "From", placeholder: "/Agents/final.json", required: true },
        { key: "to_path", label: "To", placeholder: "/Archive/final.json", required: true },
      ],
      sample: { metadata: { name: "final.json", path_display: "/Archive/final.json" } },
    }),
    action("delete", "Delete", "POST", "/2/files/delete_v2", "destructive", "Delete a file or folder.", {
      resourceLabel: "Path",
      fields: [{ key: "path", label: "Path", placeholder: "/Agents/draft.json", required: true }],
      sample: { metadata: { name: "draft.json", deleted: true } },
    }),
    action("create_shared_link", "Create shared link", "POST", "/2/sharing/create_shared_link_with_settings", "write", "Create a link anyone can use. Requires approval by default.", {
      resourceLabel: "Path",
      fields: [{ key: "path", label: "Path", placeholder: "/Agents/final.json", required: true }],
      sample: { url: "https://www.dropbox.com/scl/fi/…", link_permissions: { can_view: true } },
    }),
    action("list_shared_links", "List shared links", "POST", "/2/sharing/list_shared_links", "read", "List existing shared links.", {
      sample: { links: [{ url: "https://www.dropbox.com/scl/fi/…" }] },
    }),
    action("revoke_shared_link", "Revoke shared link", "POST", "/2/sharing/revoke_shared_link", "write", "Revoke a shared link.", {
      fields: [{ key: "url", label: "Link URL", placeholder: "https://www.dropbox.com/scl/fi/…", required: true }],
      sample: { revoked: true },
    }),
  ],
};

export default dropbox;
