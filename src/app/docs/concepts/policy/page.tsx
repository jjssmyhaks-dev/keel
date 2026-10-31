import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Policy engine — Keel docs",
  description: "How Keel decides allow, require_approval or deny on every proxied call.",
};

export default function PolicyPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="The policy engine"
      intro="Policy is evaluated in the proxy on every call, in a fixed order, with deny winning ties. The same inputs always produce the same decision, and the decision — including its reason — is written to the audit trail."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#order", name: "Evaluation order" },
            { href: "#defaults", name: "Risk defaults" },
            { href: "#approval", name: "Approval resolution" },
            { href: "#safe-launch", name: "Safe launch" },
            { href: "#autonomous", name: "Autonomous mode" },
            { href: "#rate-limits", name: "Rate limits" },
            { href: "#debug", name: "Debugging a denial" },
          ]}
        />
      }
    >
      <h2 id="order">Evaluation order</h2>
      <p>
        Each step can stop evaluation with a denial. Nothing is decrypted until every step has passed and the decision
        is <code>allow</code>.
      </p>
      <table>
        <thead>
          <tr><th>#</th><th>Check</th><th>Failure code</th></tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>Connector exists in the catalogue</td><td><code>unknown_connector</code></td></tr>
          <tr><td>2</td><td>Action exists on the connector</td><td><code>policy_denied</code></td></tr>
          <tr><td>3</td><td>Agent status is <code>active</code></td><td><code>agent_inactive</code></td></tr>
          <tr><td>4</td><td>Connection is not revoked</td><td><code>credential_revoked</code></td></tr>
          <tr><td>5</td><td>A grant links agent to connection</td><td><code>policy_denied</code></td></tr>
          <tr><td>6</td><td>Grant has not expired</td><td><code>grant_expired</code></td></tr>
          <tr><td>7</td><td>Action is named (or <code>*</code>, <code>risk:*</code>) in the grant</td><td><code>policy_denied</code></td></tr>
          <tr><td>8</td><td>Resource matches the grant pattern</td><td><code>policy_denied</code></td></tr>
          <tr><td>9</td><td>Conditions: window, call cap, IP allow-list</td><td><code>policy_denied</code></td></tr>
          <tr><td>10</td><td>Approval mode → allow, require approval, or deny</td><td><code>policy_denied</code> / <code>202</code></td></tr>
        </tbody>
      </table>
      <Callout tone="warning" title="Deny is the default">
        If no grant exists, or the grant is silent about an action, the call is denied. There is no implicit
        inheritance between agents and no ambient project access.
      </Callout>

      <h2 id="defaults">Risk defaults</h2>
      <p>
        Every connector action carries a risk level: <code>read</code>, <code>write</code>, <code>destructive</code> or{" "}
        <code>financial</code>. When neither the grant nor an approval policy sets a mode, the environment type decides.
      </p>
      <table>
        <thead>
          <tr><th>Risk</th><th>Development</th><th>Production</th></tr>
        </thead>
        <tbody>
          <tr><td><code>read</code></td><td>Allow</td><td>Allow</td></tr>
          <tr><td><code>write</code></td><td>Allow</td><td>Require approval</td></tr>
          <tr><td><code>destructive</code></td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>financial</code></td><td>Require approval</td><td>Require approval</td></tr>
        </tbody>
      </table>
      <p>
        Development is permissive for reads and writes so iteration stays fast. Anything destructive or financial
        requires a human even in development, which is why demo refunds show up in the approvals inbox.
      </p>

      <h2 id="approval">Approval resolution</h2>
      <p>
        Mode resolution walks from the most specific rule to the least. The first match wins; the decision records which
        source matched.
      </p>
      <ol>
        <li><strong>Grant approval mode</strong> — <code>allow</code>, <code>require_approval</code> or <code>deny</code>.</li>
        <li><strong>Agent approval policy</strong> — glob over action names, attached to one agent.</li>
        <li><strong>Environment approval policy</strong> — glob over action names, applies to every agent.</li>
        <li><strong>Risk default</strong> — the table above.</li>
      </ol>
      <pre>{`POST /api/v1/approval-policies
{
  "agentId": "agt_ledger",              // omit for environment-wide
  "actionPattern": "stripe.*",
  "mode": "require_approval"
}`}</pre>
      <p>
        Policies are ordered agent-first. A pattern of <code>*</code> is a useful catch-all during an incident: set it
        to <code>deny</code> to freeze a capability without deleting grants.
      </p>

      <h2 id="safe-launch">Safe launch</h2>
      <p>
        Agents created in production — or promoted from development — can start in safe-launch mode. Until{" "}
        <code>safeLaunchUntil</code> passes, every non-read action is forced to <code>require_approval</code>, even if a
        grant says <code>allow</code>. The promotion flow sets this window by default, and the agent page shows a
        countdown.
      </p>
      <p>
        Safe launch is a stronger override than grants, but weaker than an agent being inactive or a connection being
        revoked. Read actions continue to run unattended so the agent can gather context while a human reviews writes.
      </p>

      <h2 id="autonomous">Autonomous mode</h2>
      <p>
        Some agents are explicitly trusted to run unattended. Setting <code>autonomousMode</code> converts{" "}
        <code>require_approval</code> into <code>allow</code> at the final step. It never overrides a denial, an expired
        grant, a call cap or safe launch before it has elapsed. Every resulting call is still audited with{" "}
        <code>source: "autonomous"</code>, and the agent page marks the setting prominently.
      </p>
      <Callout title="When to use it">
        Autonomous mode fits bounded, reversible work: triage, digests, monitoring. Do not combine it with{" "}
        <code>financial</code> connectors or <code>*</code> grants. The approval inbox exists for the cases where the
        blast radius is not reversible.
      </Callout>

      <h2 id="rate-limits">Rate limits</h2>
      <p>
        Independent of grants, each environment sets a per-agent requests-per-minute limit for the proxy (default 120
        in development, 600 in production). Token issuance is capped at 120 requests per minute per agent. Exceeding
        either returns <code>429 rate_limited</code>; the call is not audited as allowed. Back off and retry.
      </p>

      <h2 id="debug">Debugging a denial</h2>
      <p>
        Every denial returns a decision object with the matched source and a human-readable reason. The same object is
        stored in the audit event, so the Activity page can explain a call months later.
      </p>
      <pre>{`{
  "error": {
    "code": "policy_denied",
    "message": "The grant does not include Post message (slack.post_message).",
    "decision": { "effect": "deny", "risk": "write", "source": "grant.actions" },
    "requestId": "req_..."
  }
}`}</pre>
      <p>
        Common fixes: add the named action to the grant, widen <code>resourcePattern</code>, extend{" "}
        <code>expiresAt</code>, raise a call cap, or switch the grant mode from <code>deny</code>. See{" "}
        <Link href="/app/permissions">Permissions</Link> and <Link href="/docs/concepts/approvals">Approvals</Link>.
      </p>
    </DocsShell>
  );
}
