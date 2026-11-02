import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "resend";
const action = actionFactory(slug);

const resend: Connector = {
  slug,
  name: "Resend",
  category: "Communication",
  description: "Send transactional email, manage contacts and audiences, and inspect delivery status.",
  color: "#000000",
  mark: "RE",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "bearer", label: "Resend API key" }],
  defaultAuth: "bearer",
  hosts: ["api.resend.com"],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "api_key" },
  credentialFields: [
    { key: "api_key", label: "API key", secret: true, required: true, placeholder: "re_…" },
    {
      key: "default_from",
      label: "Default sender",
      placeholder: "Keel <agents@acme.dev>",
      help: "Optional. Used when an action omits the from address. Must belong to a verified domain.",
    },
  ],
  scopes: [
    { value: "emails:send", label: "Send email and batches" },
    { value: "emails:read", label: "Read email status", optional: true },
    { value: "domains:read", label: "List domains", optional: true },
    { value: "contacts:write", label: "Create and delete contacts", optional: true },
    { value: "broadcasts:send", label: "Send broadcasts", optional: true },
  ],
  resourceLabel: "Sender or recipient domain",
  resourcePlaceholder: "acme.dev",
  status: "stable",
  version: "1.0.0",
  redactedFields: ["api_key", "authorization", "to", "bcc", "cc", "html", "text"],
  actions: [
    action("send_email", "Send email", "POST", "/emails", "write", "Send one email. Supports idempotency keys and an allowlist of recipient domains.", {
      fields: [
        { key: "from", label: "From", placeholder: "Keel <agents@acme.dev>", required: true },
        { key: "to", label: "To", placeholder: "ops@acme.dev", required: true },
        { key: "subject", label: "Subject", placeholder: "Deploy finished", required: true },
        { key: "text", label: "Body", placeholder: "Build 1842 is live." },
      ],
      sample: { id: "em_8f2a" },
    }),
    action("send_batch", "Send batch", "POST", "/emails/batch", "write", "Send up to the provider batch limit. More than 10 recipients needs approval.", {
      fields: [{ key: "emails", label: "Emails (JSON array)", placeholder: "[{…}]", required: true }],
      sample: { data: [{ id: "em_8f2b" }, { id: "em_8f2c" }] },
    }),
    action("get_email", "Get email", "GET", "/emails/{id}", "read", "Read delivery status for one email.", {
      resourceLabel: "Email",
      sample: { id: "em_8f2a", last_event: "delivered" },
    }),
    action("list_domains", "List domains", "GET", "/domains", "read", "List sending domains and verification status.", {
      sample: { data: [{ id: "d1", name: "acme.dev", status: "verified" }] },
    }),
    action("get_domain", "Get domain", "GET", "/domains/{id}", "read", "Read one sending domain.", {
      resourceLabel: "Domain",
      sample: { id: "d1", name: "acme.dev", status: "verified" },
    }),
    action("list_audiences", "List audiences", "GET", "/audiences", "read", "List audiences.", {
      sample: { data: [{ id: "a1", name: "Product updates" }] },
    }),
    action("list_contacts", "List contacts", "GET", "/contacts", "read", "List contacts in an audience.", {
      fields: [{ key: "audience_id", label: "Audience ID", placeholder: "a1" }],
      sample: { data: [{ id: "c1", email: "[redacted]" }] },
    }),
    action("create_contact", "Create contact", "POST", "/contacts", "write", "Add a contact.", {
      fields: [
        { key: "email", label: "Email", placeholder: "ops@acme.dev", required: true },
        { key: "audience_id", label: "Audience ID", placeholder: "a1" },
      ],
      sample: { id: "c2" },
    }),
    action("delete_contact", "Delete contact", "DELETE", "/contacts/{id}", "destructive", "Delete a contact.", {
      resourceLabel: "Contact",
      sample: { id: "c2", deleted: true },
    }),
    action("create_broadcast", "Create broadcast", "POST", "/broadcasts", "write", "Create a broadcast draft.", {
      fields: [
        { key: "audience_id", label: "Audience ID", placeholder: "a1", required: true },
        { key: "subject", label: "Subject", placeholder: "November update", required: true },
      ],
      sample: { id: "b1", status: "draft" },
    }),
    action("send_broadcast", "Send broadcast", "POST", "/broadcasts/{id}/send", "financial", "Send a broadcast. Reaches many people, so it needs approval.", {
      resourceLabel: "Broadcast",
      sample: { id: "b1", status: "queued" },
    }),
  ],
};

export default resend;
