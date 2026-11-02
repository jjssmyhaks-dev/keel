import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "vercel";
const action = actionFactory(slug);

const vercel: Connector = {
  slug,
  name: "Vercel",
  category: "Developer",
  description: "Inspect projects, deployments and logs, and manage environment variables and domains.",
  color: "#000000",
  mark: "VE",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "bearer", label: "Vercel access token" }],
  defaultAuth: "bearer",
  hosts: ["api.vercel.com"],
  injection: {
    type: "header",
    name: "Authorization",
    prefix: "Bearer ",
    field: "access_token",
    queryParams: [{ name: "teamId", field: "team_id" }],
  },
  credentialFields: [
    {
      key: "access_token",
      label: "Access token",
      secret: true,
      required: true,
      placeholder: "vercel_…",
      help: "Create a token scoped to the team you want this connection to act on.",
    },
    {
      key: "team_id",
      label: "Team ID",
      placeholder: "team_…",
      help: "Optional. Added as teamId on every call.",
    },
  ],
  scopes: [
    { value: "projects:read", label: "Read projects and environment variable names" },
    { value: "deployments:read", label: "Read deployments and build logs", optional: true },
    { value: "deployments:write", label: "Create and cancel deployments", optional: true },
    { value: "env:write", label: "Create and delete environment variables", optional: true },
    { value: "domains:write", label: "Attach and remove project domains", optional: true },
  ],
  resourceLabel: "Project or deployment",
  resourcePlaceholder: "acme-web",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["access_token", "authorization", "value", "env"],
  actions: [
    action("list_projects", "List projects", "GET", "/v9/projects", "read", "List projects visible to the token.", {
      fields: [{ key: "limit", label: "Limit", placeholder: "20" }],
      mock: { projects: [{ id: "prj_9f2", name: "acme-web" }] },
    }),
    action("get_project", "Get project", "GET", "/v9/projects/{id}", "read", "Read one project.", {
      resourceLabel: "Project",
      mock: { id: "prj_9f2", name: "acme-web", framework: "nextjs" },
    }),
    action("list_deployments", "List deployments", "GET", "/v6/deployments", "read", "List deployments with cursor paging.", {
      mock: { deployments: [{ uid: "dpl_8a2", state: "READY", target: "production" }] },
    }),
    action("get_deployment", "Get deployment", "GET", "/v13/deployments/{id}", "read", "Read one deployment.", {
      resourceLabel: "Deployment",
      mock: { id: "dpl_8a2", state: "READY", url: "acme-web.vercel.app" },
    }),
    action("get_deployment_events", "Get deployment logs", "GET", "/v3/deployments/{id}/events", "read", "Read build logs with secret lines redacted.", {
      resourceLabel: "Deployment",
      mock: { events: [{ type: "stdout", text: "Build completed" }] },
    }),
    action("create_deployment", "Create deployment", "POST", "/v13/deployments", "write", "Create a deployment. Production targets are treated as admin risk.", {
      fields: [
        { key: "name", label: "Project", placeholder: "acme-web", required: true },
        { key: "target", label: "Target", placeholder: "preview" },
      ],
      mock: { id: "dpl_9c4", state: "QUEUED", target: "preview" },
    }),
    action("cancel_deployment", "Cancel deployment", "PATCH", "/v12/deployments/{id}/cancel", "write", "Cancel a running deployment.", {
      resourceLabel: "Deployment",
      mock: { id: "dpl_9c4", state: "CANCELED" },
    }),
    action("promote_deployment", "Promote deployment", "POST", "/v10/projects/{id}/promote/{deploymentId}", "admin", "Promote a deployment to production.", {
      resourceLabel: "Project",
      mock: { id: "prj_9f2", promoted: "dpl_8a2" },
    }),
    action("list_env_vars", "List environment variables", "GET", "/v9/projects/{id}/env", "read", "List environment variables. Values are always redacted.", {
      resourceLabel: "Project",
      mock: { envs: [{ id: "env_1", key: "DATABASE_URL", value: "[redacted]" }] },
    }),
    action("create_env_var", "Create environment variable", "POST", "/v10/projects/{id}/env", "admin", "Create an environment variable on a project.", {
      resourceLabel: "Project",
      fields: [
        { key: "key", label: "Key", placeholder: "FEATURE_FLAG", required: true },
        { key: "value", label: "Value", placeholder: "true", required: true },
        { key: "target", label: "Targets", placeholder: "production" },
      ],
      mock: { id: "env_2", key: "FEATURE_FLAG", created: true },
    }),
    action("delete_env_var", "Delete environment variable", "DELETE", "/v9/projects/{id}/env/{envId}", "destructive", "Delete an environment variable.", {
      resourceLabel: "Project",
      mock: { id: "env_2", deleted: true },
    }),
    action("list_domains", "List domains", "GET", "/v5/domains", "read", "List domains on the account.", {
      mock: { domains: [{ name: "acme.dev", verified: true }] },
    }),
    action("add_project_domain", "Add project domain", "POST", "/v10/projects/{id}/domains", "admin", "Attach a domain to a project.", {
      resourceLabel: "Project",
      fields: [{ key: "name", label: "Domain", placeholder: "app.acme.dev", required: true }],
      mock: { name: "app.acme.dev", projectId: "prj_9f2" },
    }),
    action("remove_project_domain", "Remove project domain", "DELETE", "/v10/projects/{id}/domains/{domain}", "destructive", "Detach a domain from a project.", {
      resourceLabel: "Project",
      mock: { name: "app.acme.dev", removed: true },
    }),
  ],
};

export default vercel;
