import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Policy engine",
  description: "How Authab decides allow, require_approval or deny on every proxied call.",
};

export default function PolicyPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="The policy engine"
      intro="Policy is evaluated in the proxy on every call, in a fixed order, with deny winning ties. The same inputs always produce the same decision, and the decision — including its reason — is written to the audit trail."
      updated="11 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#order", name: "Evaluation order" },
            { href: "#defaults", name: "Risk defaults" },
            { href: "#conditions", name: "Grant conditions" },
            { href: "#approval", name: "Approval resolution" },
            { href: "#simulate", name: "Simulating decisions" },
            { href: "#jit", name: "Just-in-time grants" },
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
          <tr><td>9</td><td>Time window, allowed days and timezone</td><td><code>policy_denied</code></td></tr>
          <tr><td>10</td><td>Client IP is inside the grant&apos;s CIDR allow-list</td><td><code>policy_denied</code></td></tr>
          <tr><td>11</td><td>Amount is present and under the ceiling</td><td><code>policy_denied</code></td></tr>
          <tr><td>12</td><td>Call cap for the rolling period is not exceeded</td><td><code>policy_denied</code></td></tr>
          <tr><td>13</td><td>Approval mode → allow, require approval, or deny</td><td><code>policy_denied</code> / <code>202</code></td></tr>
        </tbody>
      </table>
      <Callout tone="warning" title="Deny is the default">
        If no grant exists, or the grant is silent about an action, the call is denied. There is no implicit
        inheritance between agents and no ambient project access.
      </Callout>

      <h2 id="defaults">Risk defaults</h2>
      <p>
        Every connector action carries a risk level: <code>read</code>, <code>write</code>, <code>admin</code>,{" "}
        <code>destructive</code> or <code>financial</code>. When neither the grant nor an approval policy sets a mode,
        the environment type decides.
      </p>
      <table>
        <thead>
          <tr><th>Risk</th><th>Development</th><th>Production</th></tr>
        </thead>
        <tbody>
          <tr><td><code>read</code></td><td>Allow</td><td>Allow</td></tr>
          <tr><td><code>write</code></td><td>Allow</td><td>Require approval</td></tr>
          <tr><td><code>admin</code></td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>destructive</code></td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>financial</code></td><td>Require approval</td><td>Require approval</td></tr>
        </tbody>
      </table>
      <p>
        Development is permissive for reads and writes so iteration stays fast. Anything that changes access or
        configuration, deletes data, or moves money requires a human even in development, which is why demo refunds show
        up in the approvals inbox. Imported connectors inherit the same levels unless the spec marks an action with an{" "}
        <code>x-authab-risk</code> override.
      </p>

      <h2 id="conditions">Grant conditions</h2>
      <p>
        Conditions narrow a grant without changing who holds it. They live in the grant&apos;s{" "}
        <code>conditions</code> object and every one of them fails closed: a malformed rule, a missing client IP or a
        missing amount is a denial, never a skip.
      </p>
      <pre>{`POST /api/v1/grants
{
  "agentId": "agt_ledger",
  "credentialId": "cred_...",
  "actions": ["stripe.create_refund"],
  "conditions": {
    "allowedIps": "203.0.113.0/24, 2001:db8::/32",
    "allowedDays": "mon,tue,wed,thu,fri",
    "timeWindowStart": "09:00",
    "timeWindowEnd": "18:00",
    "timezone": "Europe/London",
    "maxAmount": 500,
    "approvalAboveAmount": 100,
    "amountField": "amount",
    "maxCallsPerPeriod": 20,
    "periodHours": 24
  }
}`}</pre>
      <table>
        <thead>
          <tr><th>Field</th><th>Behaviour</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>allowedIps</code></td>
            <td>Comma-separated IPv4/IPv6 CIDR or exact addresses. The request IP must match one; no IP on the request is a denial.</td>
          </tr>
          <tr>
            <td><code>allowedDays</code></td>
            <td>Weekday names or 0–6 (Sunday = 0), evaluated in the grant&apos;s timezone.</td>
          </tr>
          <tr>
            <td><code>timeWindowStart</code> / <code>timeWindowEnd</code></td>
            <td><code>HH:MM</code> inclusive. A start later than the end wraps midnight (for example 22:00–06:00).</td>
          </tr>
          <tr>
            <td><code>timezone</code></td>
            <td>IANA zone such as <code>America/New_York</code>; defaults to UTC. An invalid zone denies.</td>
          </tr>
          <tr>
            <td><code>maxAmount</code></td>
            <td>Hard ceiling. A request without a numeric <code>amountField</code> denies when this is set.</td>
          </tr>
          <tr>
            <td><code>approvalAboveAmount</code></td>
            <td>At or above this value the call is forced to <code>require_approval</code>, even if the mode is <code>allow</code>.</td>
          </tr>
          <tr>
            <td><code>amountField</code></td>
            <td>Dot path into the action input, default <code>amount</code>.</td>
          </tr>
          <tr>
            <td><code>maxCallsPerPeriod</code> / <code>periodHours</code></td>
            <td>Rolling cap on allowed calls for this agent and action; period defaults to 24 hours.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Conditions can be set on a normal grant or on a just-in-time grant activated by an approval. The simulate
        endpoint below reports each condition in its trace, so you can test a rule before an agent depends on it.
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
  "mode": "require_approval",
  "slaMinutes": 30,                     // escalate when still pending
  "escalateToRole": "admin"
}`}</pre>
      <p>
        Policies are ordered agent-first. A pattern of <code>*</code> is a useful catch-all during an incident: set it
        to <code>deny</code> to freeze a capability without deleting grants. When <code>slaMinutes</code> is set, the
        approval gets a due time and is escalated once if it is still pending; environments without a matching policy
        can use the <code>escalateAfterMinutes</code> setting as a fallback.
      </p>

      <h2 id="simulate">Simulating decisions</h2>
      <p>
        The policy lab answers &ldquo;what would happen if this agent made this call?&rdquo; without calling the
        provider, decrypting the credential or writing an audit event. Call it with a secret key and the same inputs the
        proxy would see.
      </p>
      <pre>{`POST /api/v1/policy/simulate
{
  "agentId": "agt_ledger",
  "credentialId": "cred_...",
  "action": "stripe.create_refund",
  "resource": "charge/ch_123",
  "input": { "amount": 250, "charge": "ch_123" },
  "ip": "203.0.113.9",
  "now": "2026-11-11T10:30:00Z"
}

200 {
  "object": "policy_simulation",
  "simulated": true,
  "decision": { "effect": "require_approval", "risk": "financial",
                "source": "grant.conditions.amount", "wouldExecute": false,
                "wouldRequestApproval": true },
  "trace": [ ... one step per evaluation rule ... ]
}`}</pre>
      <p>
        <code>ip</code> and <code>now</code> are optional; pass them to test IP allow-lists and time windows at a
        specific moment. The trace names every rule that passed, failed or was skipped, which makes a denial
        reproducible. The same evaluation powers the Policy lab in the dashboard, so a saved scenario and a real call
        cannot disagree.
      </p>

      <h2 id="jit">Just-in-time grants</h2>
      <p>
        Instead of asking for standing access, an agent can request the exact actions it needs for a limited window.
        The request creates an inactive grant and a pending approval; nothing is callable until a human approves, and
        the grant expires automatically after the requested duration (5 to 1,440 minutes, default 60).
      </p>
      <pre>{`POST /api/v1/grants/request        Authorization: Bearer <agent token>
{
  "connector": "stripe",
  "actions": ["stripe.create_refund"],
  "resourcePattern": "charge/ch_123",
  "reason": "Refund requested by support ticket 4412",
  "durationMinutes": 30
}

202 { "object": "grant_request", "status": "pending_approval",
      "approvalId": "apr_...", "grantId": "grt_...", "expiresAt": "..." }`}</pre>
      <p>
        Approval activates the grant, records <code>grant.activated</code> and sets the expiry. Requests are limited to
        ten per minute per agent, and the endpoint refuses to create a standing grant, a second pending request, or a
        request on a revoked or unhealthy connection. If the agent already holds standing access, use that grant
        instead. Approval decisions and escalation are covered under{" "}
        <Link href="/docs/concepts/approvals">Approvals</Link>.
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
