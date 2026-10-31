import type { Metadata } from "next";
import Link from "next/link";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Grants — Keel docs",
  description: "Scope an agent to specific connector actions, resources, conditions and approval modes.",
};

export default function GrantsPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Grants"
      intro="A grant is one line in the permission graph: this agent, this connection, these actions, this resource pattern, under these conditions. Nothing outside a grant is reachable, and every change is written to the permission log."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#shape", name: "Anatomy" },
            { href: "#actions", name: "Actions and wildcards" },
            { href: "#resources", name: "Resource patterns" },
            { href: "#conditions", name: "Conditions" },
            { href: "#approval", name: "Approval overrides" },
            { href: "#lifecycle", name: "Creating and changing" },
            { href: "#matrix", name: "The matrix" },
          ]}
        />
      }
    >
      <h2 id="shape">Anatomy</h2>
      <pre>{`{
  "agentId": "agt_atlas",
  "credentialId": "cred_slack_research",
  "actions": ["slack.post_message"],
  "resourcePattern": "research-*",
  "conditions": { "timeWindowStart": "09:00", "timeWindowEnd": "19:00",
                  "maxCallsPerPeriod": 40, "periodHours": 24,
                  "allowedIps": "10.0.0." },
  "approvalMode": "require_approval",
  "purpose": "Post launch briefs to research channels",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}`}</pre>
      <p>
        There is at most one grant per agent/connection pair. Editing the grant is the normal way to widen or narrow
        access; revoke and recreate only when you want a clean audit boundary. Both changes are recorded with before
        and after values in the permission log.
      </p>

      <h2 id="actions">Actions and wildcards</h2>
      <p>
        Actions use the <code>connector.verb</code> form — <code>slack.post_message</code>,{" "}
        <code>stripe.create_refund</code>, <code>github.create_issue</code>. Grants accept four forms:
      </p>
      <table>
        <thead>
          <tr><th>Pattern</th><th>Grants</th><th>Guidance</th></tr>
        </thead>
        <tbody>
          <tr><td><code>slack.post_message</code></td><td>One named action</td><td>Default. Use this.</td></tr>
          <tr><td><code>*</code></td><td>Every action on the connection</td><td>Only for harnesses and sandboxes.</td></tr>
          <tr><td><code>risk:read</code></td><td>Every read-risk action</td><td>Useful for dashboards and monitors.</td></tr>
          <tr><td><code>read</code></td><td>Same as <code>risk:read</code></td><td>Accepted shorthand.</td></tr>
        </tbody>
      </table>
      <p>
        Unknown actions are rejected when the grant is created. The gateway also refuses to call an action that is not
        in the connector catalogue, so a typo cannot silently widen access. The token&apos;s <code>scopes</code> claim is
        derived from these entries.
      </p>

      <h2 id="resources">Resource patterns</h2>
      <p>
        <code>resourcePattern</code> is matched with glob semantics against the resource the agent sends — a channel,
        repository, invoice, mailbox or model name, depending on the connector. <code>*</code> matches any resource; a
        pattern such as <code>acme/*</code> matches a namespace. Case matters, and a missing resource is treated as{" "}
        <code>null</code>, which only matches <code>*</code>.
      </p>
      <pre>{`resource: "#research-launch"   pattern: "research-*"    ✅
resource: "#support-billing"   pattern: "research-*"    ⛔ policy_denied`}</pre>

      <h2 id="conditions">Conditions</h2>
      <table>
        <thead>
          <tr><th>Key</th><th>Type</th><th>Effect</th></tr>
        </thead>
        <tbody>
          <tr><td><code>timeWindowStart</code> / <code>timeWindowEnd</code></td><td><code>HH:MM</code></td><td>Call must fall inside the local server window. Windows may wrap midnight.</td></tr>
          <tr><td><code>maxCallsPerPeriod</code></td><td>number</td><td>Cap on successful calls for this action in the window.</td></tr>
          <tr><td><code>periodHours</code></td><td>number</td><td>Length of the rolling window, default 24.</td></tr>
          <tr><td><code>allowedIps</code></td><td>comma-separated prefixes</td><td>Request IP must start with one of the listed values.</td></tr>
        </tbody>
      </table>
      <p>
        Conditions are enforced before approval routing. An exhausted call cap does not create an approval request; it
        is a hard denial recorded as <code>policy_denied</code>.
      </p>

      <h2 id="approval">Approval overrides</h2>
      <p>
        <code>approvalMode</code> can be <code>allow</code>, <code>require_approval</code> or <code>deny</code>. It
        takes precedence over environment and agent approval policies, which in turn take precedence over the risk
        default. Leave it <code>null</code> to inherit. A grant-level denial is the cleanest way to switch off one
        capability without deleting the connection.
      </p>

      <h2 id="lifecycle">Creating and changing</h2>
      <pre>{`POST /api/v1/grants
{
  "agentId": "agt_atlas",
  "credentialId": "cred_slack_research",
  "actions": ["slack.post_message"],
  "resourcePattern": "research-*",
  "approvalMode": "require_approval",
  "conditions": { "maxCallsPerPeriod": 40, "periodHours": 24 }
}

PATCH /api/v1/grants/:id      # actions, resource, conditions, mode, expiry
DELETE /api/v1/grants/:id     # remove the grant; tokens lose the scope on next issue`}</pre>
      <p>
        Existing tokens keep their scopes until they expire (five minutes by default), but the proxy re-checks the grant
        on every call. Deleting a grant therefore stops calls immediately, not in five minutes.
      </p>

      <h2 id="matrix">The matrix</h2>
      <p>
        The <Link href="/app/permissions">Permissions</Link> page shows agents against connections. A black cell means
        at least one non-read action is granted; a green cell means read-only access. Click a cell to edit that grant,
        including conditions and approval mode. Dashed cells have no grant — they stay denied until you create one.
      </p>
      <p>
        Expiring grants are highlighted fourteen days ahead of their timestamp. A grant that expires is denied at the
        gateway with <code>grant_expired</code>; the agent keeps its identity, and the connection stays in the vault.
      </p>
    </DocsShell>
  );
}
