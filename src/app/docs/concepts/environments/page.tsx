import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Environments and promotion",
  description: "Keep development and production isolated, then promote a tested agent with a reviewed grant diff.",
};

export default function EnvironmentsPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Environments and promotion"
      intro="Every project has two environments: development and production. They share a policy model but nothing else — separate agents, credentials, grants, approvals, audit chains and API keys. Promotion is how an agent crosses the line, with a diff a human signs off on."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#isolation", name: "What is separate" },
            { href: "#differences", name: "Behaviour differences" },
            { href: "#promotion", name: "Promotion" },
            { href: "#readiness", name: "Readiness checks" },
            { href: "#safe-launch", name: "Safe launch" },
            { href: "#keys", name: "API keys" },
          ]}
        />
      }
    >
      <h2 id="isolation">What is separate</h2>
      <p>
        A development agent cannot call a production credential, and a production token cannot read development data.
        The boundary is enforced on every proxy call, approval decision and audit write. Even within one project, the
        two environments never share:
      </p>
      <ul>
        <li>Agents and agent keys (promotion mints a new keypair)</li>
        <li>Credentials and their encryption keys</li>
        <li>Grants, approval policies and approval requests</li>
        <li>Audit chains and sequence numbers</li>
        <li>Webhook endpoints and alert rules</li>
        <li>API keys — <code>sk_dev_…</code> cannot act on production</li>
      </ul>
      <p>
        Switching environments in the dashboard is a dated session event; the active environment is stored server-side
        in the session cookie, not in client state. Every page re-resolves permissions for the environment it is
        about to show.
      </p>

      <h2 id="differences">Behaviour differences</h2>
      <table>
        <thead>
          <tr><th>Setting</th><th>Development</th><th>Production</th></tr>
        </thead>
        <tbody>
          <tr><td>Default approval for writes</td><td>Allow</td><td>Require approval</td></tr>
          <tr><td>Destructive / financial</td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td>Approval expiry</td><td>60 minutes</td><td>30 minutes</td></tr>
          <tr><td>Proxy rate limit</td><td>120 / minute / agent</td><td>600 / minute / agent</td></tr>
          <tr><td>Mock execution</td><td>On by default</td><td>Off per environment; live egress requires <code>KEEL_PROXY_LIVE=1</code> at the deployment</td></tr>
          <tr><td>Allowed domains</td><td>Unrestricted</td><td>Configurable allow-list</td></tr>
        </tbody>
      </table>
      <p>
        Mock mode is a development convenience: the connector returns its declared sample response without contacting
        the provider, and the response is marked <code>_keel.mock: true</code>. It is never enabled in production. A
        second, deployment-level switch controls live egress for the whole instance: unless the operator sets{" "}
        <code>KEEL_PROXY_LIVE=1</code>, no request leaves Keel even when mock mode is off. This makes a demo or a
        staging instance safe by default. The guardrails page shows each environment&apos;s mock setting, and every
        response reports whether it was mocked.
      </p>

      <h2 id="promotion">Promotion</h2>
      <p>
        Promotion creates a <strong>new</strong> agent in production. It does not copy keys. The production agent gets a
        fresh Ed25519 identity, the same name (suffixed with <code>-prod</code> on collision), description, tags, owner
        and framework, and a grant for every development grant whose connector has a production credential.
      </p>
      <pre>{`development                          production
agt_atlas  ──promote──▶  agt_atlas_prod (new keypair)
  ├─ slack  post_message          ├─ slack  post_message   (approvalMode: require_approval)
  └─ openai chat_completion       └─ openai chat_completion (production credential)`}</pre>
      <p>
        Grants without a production counterpart are listed in the diff as skipped, not silently dropped. Approval
        policies attached to the development agent are copied. Production starts in safe launch.
      </p>
      <Callout title="Promotion is one-way">
        There is no automatic demotion. If production needs to stop, pause or kill the production agent. Editing the
        development agent afterwards does not change production; promote again only when you intend to create a new
        production identity.
      </Callout>

      <h2 id="readiness">Readiness checks</h2>
      <p>
        Before the confirmation step, Keel evaluates the development agent and blocks or warns:
      </p>
      <table>
        <thead>
          <tr><th>Check</th><th>Blocks?</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr><td>Plan supports production</td><td>Yes</td><td>Free is development-only.</td></tr>
          <tr><td>Promoting account has verified email</td><td>Yes</td><td>Production changes need an accountable human.</td></tr>
          <tr><td>Role has production write access</td><td>Yes</td><td>Owners and admins only.</td></tr>
          <tr><td>Agent not already promoted</td><td>Yes</td><td>One production identity per development agent.</td></tr>
          <tr><td>Description present</td><td>No (warn)</td><td>Approvers need context.</td></tr>
          <tr><td>Owner assigned</td><td>No (warn)</td><td>Someone must own production traffic.</td></tr>
          <tr><td>Every write has an explicit approval mode</td><td>No (warn)</td><td>Otherwise safe launch holds writes for seven days.</td></tr>
          <tr><td>Production connections exist</td><td>No (warn)</td><td>Missing connectors are skipped in the diff.</td></tr>
        </tbody>
      </table>

      <h2 id="safe-launch">Safe launch</h2>
      <p>
        A promoted agent runs with <code>safeLaunchUntil</code> set seven days ahead. During that window every non-read
        action is forced to <code>require_approval</code>, regardless of the copied grant mode. Read-only calls run
        unattended so the agent can work while humans watch. You can clear the window early from the agent page once
        you trust the behaviour — the change is audited.
      </p>

      <h2 id="keys">API keys</h2>
      <p>
        Each environment has its own secret and publishable keys. Secret keys are shown once at creation; only a
        prefix and last-used timestamp remain afterwards. Revoking a key takes effect immediately for new requests.
        Dashboard sessions are separate from API keys and can be revoked individually under{" "}
        <Link href="/app/settings">Settings → Sessions</Link>.
      </p>
      <p>
        See <Link href="/docs/api">API reference</Link> for authentication and <Link href="/app/security">Security</Link>{" "}
        for guardrails that apply to both environments.
      </p>
    </DocsShell>
  );
}
