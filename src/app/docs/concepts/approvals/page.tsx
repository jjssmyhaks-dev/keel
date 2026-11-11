import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Approvals",
  description: "Human-in-the-loop decisions for risky agent actions, with signed links and safe execution.",
};

export default function ApprovalsPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Approvals"
      intro="Approvals are how an agent escalates instead of failing. The request is stored with a redacted payload, sent to the people who can decide, and executed by Authab once a human approves — never by the agent."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#lifecycle", name: "Lifecycle" },
            { href: "#request", name: "What is stored" },
            { href: "#deciding", name: "Deciding" },
            { href: "#execution", name: "Execution" },
            { href: "#polling", name: "Polling safely" },
            { href: "#links", name: "Approval links" },
            { href: "#expiry", name: "Expiry" },
            { href: "#api", name: "API" },
          ]}
        />
      }
    >
      <h2 id="lifecycle">Lifecycle</h2>
      <p>
        When policy returns <code>require_approval</code>, the proxy creates an approval request and returns{" "}
        <code>202 Accepted</code>. The request moves through <code>pending → approved | denied | expired</code>; an
        approved call that fails at the provider ends as <code>failed</code> with the error stored alongside it.
      </p>
      <pre>{`agent request ──▶ policy: require_approval
                ├─ 202 { status: "pending_approval", approval, approvalUrl }
                ├─ human approves ──▶ Authab executes ──▶ status: approved
                └─ human denies   ──▶ status: denied`}</pre>

      <h2 id="request">What is stored</h2>
      <p>
        An approval stores the agent, connection, grant, action, resource, risk, request id and a{" "}
        <strong>redacted</strong> copy of the payload. Redaction strips the fields the connector marks sensitive (API
        tokens, authorization headers, message bodies) before the row is written. The unredacted payload needed for
        execution is kept separately and is never exposed through the API or dashboard.
      </p>
      <p>
        Approvers see enough context to judge intent: which agent, which action, which resource, how risky, and why
        policy escalated it. They do not see the provider secret.
      </p>

      <h2 id="deciding">Deciding</h2>
      <p>
        Anyone with the <code>approve</code> capability can decide: owners, admins and approvers. Viewers and developers
        can read the inbox but cannot decide. In production, the decider also needs write access to production.
      </p>
      <p>
        A decision stores the decider, timestamp and an optional note (500 characters). Choosing{" "}
        <strong>Approve always</strong> also flips the underlying grant&apos;s <code>approvalMode</code> to{" "}
        <code>allow</code>, so the same agent can repeat that action without a new request. Use it deliberately — the
        change is recorded in the permission log as well as the audit trail.
      </p>

      <h2 id="execution">Execution</h2>
      <p>
        Approving executes the call immediately, server-side, with the credential injected by the proxy. The agent does
        not re-send the request and never holds the secret. The execution result — status, provider body and latency — is
        stored on the approval and shown on its page.
      </p>
      <Callout tone="warning" title="Approval is not idempotent by itself">
        If the provider succeeds but the network drops before Authab records the result, the approval is marked{" "}
        <code>failed</code> rather than retried automatically. Check the provider before deciding again. Provider
        idempotency keys are your second line of defence for financial actions.
      </Callout>

      <h2 id="polling">Polling safely</h2>
      <p>
        The agent gets a <code>202</code> with the approval id. Retry the identical proxy request with the same{" "}
        <code>Idempotency-Key</code>: while the approval is pending Authab replays the <code>202</code>; after a decision
        it replays the final outcome — <code>200 executed</code> with the provider result, or <code>403</code> if the
        approval was denied or expired. The provider is never called twice for the same key.
      </p>
      <pre>{`// first attempt
POST /v1/proxy/slack        Idempotency-Key: slack-post-launch-v3
← 202 { status: "pending_approval", approval: { id: "apr_...", status: "pending" } }

// after the human decides, identical retry
POST /v1/proxy/slack        Idempotency-Key: slack-post-launch-v3
← 200 { status: "executed", result: { status: 200, body: { ok: true } } }
  header: idempotency-replayed: true`}</pre>
      <p>
        A trusted backend can also read the approval directly with a secret key —{" "}
        <code>GET /v1/approvals/:id</code> returns <code>status</code> and <code>executionResult</code>. That is the
        simpler path if your orchestrator already holds an API key.
      </p>

      <h2 id="links">Approval links</h2>
      <p>
        Each request carries an HMAC-signed token. The link <code>https://authab.dev/approve/&lt;signed-token&gt;</code>{" "}
        opens a minimal decision page without requiring a dashboard session, but still requires the viewer to be signed
        in as a member with approval rights. Links expire with the request and cannot be replayed after a decision.
      </p>
      <p>
        Approval emails use the same signed link. Treat it as sensitive: anyone with approval rights who holds the link
        can decide.
      </p>

      <h2 id="expiry">Expiry</h2>
      <p>
        Expiry is set per environment — 60 minutes by default, configurable from 5 to 1,440 minutes. Expired requests
        are closed automatically and cannot be approved afterwards. The agent sees the expiry as a denial on its next
        idempotent retry.
      </p>

      <h2 id="api">API</h2>
      <table>
        <thead>
          <tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td><code>GET</code></td><td><code>/v1/approvals?status=pending</code></td><td>List requests for the environment.</td></tr>
          <tr><td><code>GET</code></td><td><code>/v1/approvals/:id</code></td><td>Read status and execution result.</td></tr>
          <tr><td><code>POST</code></td><td><code>/v1/approvals/:id</code></td><td>Approve or deny with <code>{"{ decision, note?, approveAlways? }"}</code>.</td></tr>
        </tbody>
      </table>
      <p>
        The decision endpoint requires a secret key, records the acting API key as the decider, and returns the
        updated approval with the execution result attached. See the <Link href="/docs/api">API reference</Link> for
        error codes, and <Link href="/app/approvals">Approvals</Link> for the human interface.
      </p>
    </DocsShell>
  );
}
