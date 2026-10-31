import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Audit trail — Keel docs",
  description: "A tamper-evident, hash-chained record of every identity, permission, proxy and approval event.",
};

export default function AuditPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Audit trail"
      intro="Every meaningful action in an environment — token issuance, credential rotation, grant edits, proxy calls, denials, approvals — is appended to a hash chain. You can prove the log was not edited after the fact, and export the whole thing without losing the proof."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#chain", name: "How the chain works" },
            { href: "#events", name: "Event shape" },
            { href: "#coverage", name: "What is recorded" },
            { href: "#verify", name: "Verification" },
            { href: "#export", name: "Export and streaming" },
            { href: "#retention", name: "Retention" },
          ]}
        />
      }
    >
      <h2 id="chain">How the chain works</h2>
      <p>
        Events are numbered per environment starting at one. Each event stores the previous event&apos;s hash and its own
        hash, computed as:
      </p>
      <pre>{`hash = SHA-256( prevHash + ":" + canonicalJSON(body) )

body = {
  seq, timestamp, actorType, actorId, actorName,
  action, resourceType, resourceId, outcome,
  requestId, ip, agentId, payloadSummary
}`}</pre>
      <p>
        Canonical JSON sorts object keys, so the hash is stable across serialisers. The first event in an environment
        uses a fixed genesis value for <code>prevHash</code>. Writing a new event reads the current head and inserts the
        next link inside a transaction; the audit writer retries on contention rather than dropping an event.
      </p>
      <Callout tone="warning" title="What the chain does and does not prove">
        The chain detects edits, deletions and reordering within an environment after the fact. It does not prevent
        someone with full database access from rewriting the entire chain. For that, anchor hashes externally — export
        daily and store the last hash in your own system, or stream events to a WORM sink.
      </Callout>

      <h2 id="events">Event shape</h2>
      <pre>{`{
  "seq": 106,
  "timestamp": "2026-10-31T00:17:04.120Z",
  "actor": { "type": "agent", "id": "agt_atlas", "name": "Atlas Research" },
  "action": "proxy.call",
  "resource": { "type": "connector", "id": "slack" },
  "outcome": "allowed",
  "requestId": "req_k3f9a2",
  "agentId": "agt_atlas",
  "ip": "10.0.4.18",
  "payload": { "action": "slack.post_message", "resource": "#research-launch" },
  "prevHash": "9f2c…",
  "hash": "c41d…"
}`}</pre>
      <p>
        Outcomes are <code>recorded</code>, <code>allowed</code>, <code>denied</code>, <code>approved</code>,{" "}
        <code>denied</code> (human), <code>error</code> or <code>pending</code> depending on the event family. Payloads
        are summaries, never full secrets or full provider bodies.
      </p>

      <h2 id="coverage">What is recorded</h2>
      <table>
        <thead>
          <tr><th>Family</th><th>Examples</th></tr>
        </thead>
        <tbody>
          <tr><td>Identity</td><td><code>agent.registered</code>, <code>agent.paused</code>, <code>agent.rotated</code>, <code>token.issued</code>, <code>token.revoked</code></td></tr>
          <tr><td>Vault</td><td><code>credential.created</code>, <code>credential.rotated</code>, <code>credential.revoked</code>, <code>credential.health_changed</code></td></tr>
          <tr><td>Access</td><td><code>grant.created</code>, <code>grant.updated</code>, <code>grant.deleted</code>, <code>permission.changed</code></td></tr>
          <tr><td>Runtime</td><td><code>proxy.call</code> with outcome <code>allowed</code> or <code>denied</code>, including the decision source</td></tr>
          <tr><td>Human loop</td><td><code>approval.requested</code>, <code>approval.decided</code>, <code>policy.created</code></td></tr>
          <tr><td>Operational</td><td><code>audit.exported</code>, <code>audit.verified</code>, <code>settings.updated</code>, <code>webhook.created</code></td></tr>
        </tbody>
      </table>
      <p>
        Human actions name the human; agent actions name the agent and optionally the human principal that requested
        the token. Read-only roles can view the trail but cannot export secrets because none exist in it.
      </p>

      <h2 id="verify">Verification</h2>
      <pre>{`GET /api/v1/audit/verify?from=1&to=106

200 {
  "object": "audit_verification",
  "environment": "development",
  "valid": true,
  "eventsChecked": 106,
  "brokenAtSeq": null,
  "verifiedAt": "2026-10-31T00:20:11.002Z"
}`}</pre>
      <p>
        A failed check returns <code>valid: false</code> and the first sequence whose hash or link does not match.
        Verification itself is audited (<code>audit.verified</code>), so a tamper attempt that also deletes the
        verification event still leaves the chain inconsistent at the tail.
      </p>
      <p>
        Run it from <Link href="/app/activity">Activity</Link> or <Link href="/app/security">Security</Link>. Verify
        after any incident, before exporting evidence, and on a schedule if your compliance team needs a record.
      </p>

      <h2 id="export">Export and streaming</h2>
      <p>
        Export the raw chain as CSV or JSONL with the same fields as the API:
      </p>
      <pre>{`GET /v1/audit/export?format=csv&from=2026-10-01&to=2026-10-31
# x-keel-export-count: 18422

GET /v1/audit?limit=100&order=asc&before=4200
GET /v1/audit/export?format=jsonl&agent=agt_ledger`}</pre>
      <p>
        CSV is for spreadsheets and SIEM ingestion; JSONL preserves <code>prevHash</code> and <code>hash</code>. Both
        include actor, action, resource, outcome, request id and payload summary. Exports are logged as{" "}
        <code>audit.exported</code> with the row count and filters.
      </p>
      <p>
        For near-real-time delivery, subscribe webhooks to <code>proxy.call</code>,{" "}
        <code>approval.requested</code> and <code>approval.decided</code>. Each delivery is signed with{" "}
        <code>Keel-Signature: t=…,v1=…</code> (HMAC-SHA256 over <code>timestamp.body</code>), includes a stable event
        id, and retries with backoff. Treat webhooks as a notification channel, not the system of record — reconcile
        against the export.
      </p>

      <h2 id="retention">Retention</h2>
      <p>
        Audit events are retained for the life of the environment. Deleting an environment removes its chain; there is
        no per-event delete API. If your policy requires independent retention, export on a schedule and store the
        final hash of each export alongside it.
      </p>
    </DocsShell>
  );
}
