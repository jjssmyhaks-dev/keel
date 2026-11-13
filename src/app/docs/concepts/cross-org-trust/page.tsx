import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Cross-organization trust",
  description: "Let another company's agent call your connectors under a scoped, revocable trust relationship — without sharing credentials.",
};

export default function CrossOrgTrustPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Cross-organization trust"
      intro="Sometimes the agent that needs your Slack workspace belongs to a partner. A trust relationship admits that agent into your environment as a shadow agent: it holds no keys, sees no credentials, and only reaches what your grants allow."
      updated="13 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#when", name: "When to use it" },
            { href: "#model", name: "The shadow agent" },
            { href: "#flow", name: "The flow" },
            { href: "#invite", name: "1. Invite" },
            { href: "#accept", name: "2. Accept" },
            { href: "#grant", name: "3. Grant scopes" },
            { href: "#exchange", name: "4. Exchange a token" },
            { href: "#revoke", name: "5. Revoke" },
            { href: "#rules", name: "Rules and limits" },
            { href: "#dashboard", name: "In the dashboard" },
          ]}
        />
      }
    >
      <h2 id="when">When to use it</h2>
      <p>
        Use cross-organization trust when a partner or vendor agent must act inside your tools — a support partner
        triaging your Slack, an agency updating your CMS, a logistics agent reading your Sheets. Sharing an API key works
        until you need to know what the agent did, limit it to three actions, or revoke it in one place. A trust
        relationship gives you all three.
      </p>
      <p>
        End-user consent covers a person granting access to their own accounts. Cross-organization trust covers another
        organization&apos;s agent acting on your organization&apos;s accounts. Both use short-lived tokens and neither
        exposes a raw credential.
      </p>

      <h2 id="model">The shadow agent</h2>
      <p>
        When the external organization accepts, Authab creates a <strong>shadow agent</strong> in the owner&apos;s
        environment. It mirrors the external agent&apos;s name, type and key fingerprint, but it has no private key and
        cannot be issued tokens directly. Your grants are attached to the shadow agent. So is every proxy call, audit
        event and agent event, which means the partner&apos;s traffic is indistinguishable from a local agent&apos;s in
        your logs — except that it is clearly marked as external.
      </p>
      <p>
        The external agent keeps using its own identity in its own environment. The trust relationship is the only bridge,
        and it can be torn down from either side.
      </p>

      <h2 id="flow">The flow</h2>
      <pre>{`owner org                      Authab                     external org
   │  POST /trust-relationships  │                            │
   │────────────────────────────▶│  trust.invited webhook     │
   │                             │───────────────────────────▶│
   │                             │  POST …/:id/accept         │
   │                             │◀───────────────────────────│
   │                             │  creates shadow agent      │
   │  grant actions to the shadow│                            │
   │────────────────────────────▶│                            │
   │                             │  POST /tokens/trust-exchange
   │                             │◀───────────────────────────│
   │                             │  5-minute shadow token     │
   │                             │  (grants ∩ maxScopes ∩ ask)│
   │                             │───────────────────────────▶│
   │                             │◀── proxy call, audited ────│`}</pre>

      <h2 id="invite">1. Invite</h2>
      <p>
        The owner organization needs the external agent&apos;s id. Agents are not discoverable by name across
        organizations; the partner shares the id out of band. Optionally set a note and a{" "}
        <code>maxScopes</code> ceiling that no later token can exceed.
      </p>
      <pre>{`const invitation = await authab.trust.create({
  externalAgentId: "agt_partner_support",
  note: "Acme Support triage, Q4 contract",
  maxScopes: ["slack.post_message", "slack.read_channel_history"],
});`}</pre>
      <p>
        Inviting dispatches <code>trust.invited</code> to the owner&apos;s webhooks and emails the external
        organization&apos;s admins. The invitation is not access: nothing is callable until the partner accepts and you
        grant the shadow agent.
      </p>

      <h2 id="accept">2. Accept</h2>
      <p>
        The external organization lists inbound invitations with <code>side=external</code> and accepts. Only a secret
        key from the invited environment can accept.
      </p>
      <pre>{`const inbound = await authab.trust.list({ side: "external" });
const accepted = await authab.trust.accept(inbound.relationships[0].id);
// accepted = { id, status: "active", shadowAgentId: "agt_shadow_..." }`}</pre>
      <p>
        Accepting creates the shadow agent, writes <code>trust.accepted</code> audit events in both organizations, and
        dispatches <code>trust.accepted</code> to both sides. It performs no provider calls and grants no actions.
      </p>

      <h2 id="grant">3. Grant scopes</h2>
      <p>
        Treat the shadow agent like any new local agent: give it the smallest grant that works. In the dashboard it
        appears under <Link href="/app/agents">Agents</Link> with an external marker; in the API use its{" "}
        <code>shadowAgentId</code> with <code>authab.grants.create</code>. Nothing the external agent requests later can
        exceed these grants.
      </p>
      <pre>{`await authab.grants.create({
  agentId: accepted.shadowAgentId,
  credentialId: slackCredential.id,
  actions: ["slack.post_message"],
  resourcePattern: "support-*",
  approvalMode: "require_approval",
  purpose: "Partner support triage",
});`}</pre>

      <h2 id="exchange">4. Exchange a token</h2>
      <p>
        The external agent calls <code>POST /v1/tokens/trust-exchange</code> with its own short-lived token and the
        relationship id. Authab computes the usable scopes as the intersection of the shadow agent&apos;s grant actions,
        the relationship&apos;s <code>maxScopes</code>, and whatever the caller asked for — and issues a five-minute token
        on the shadow agent.
      </p>
      <pre>{`// on the external agent, with its own bearer token
const shadow = await authab.tokens.trustExchange({
  trustRelationshipId: relationship.id,
  scopes: ["slack.post_message"],
});

await fetch("https://api.authab.dev/v1/proxy/slack", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${shadow.access_token}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "slack.post_message",
    resource: "support-billing",
    input: { channel: "C012345", text: "Triage complete." },
  }),
});`}</pre>
      <p>The token carries the cross-organization context explicitly:</p>
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>sub</code></td><td>The shadow agent id in the owner&apos;s environment.</td></tr>
          <tr><td><code>act.sub</code>, <code>act.env</code></td><td>The external agent and its environment — who is really acting.</td></tr>
          <tr><td><code>trust</code></td><td>The relationship id. Every authenticated request re-checks it is still active.</td></tr>
          <tr><td><code>x_org</code></td><td>Always <code>true</code>, so downstream policy and logs can flag external traffic.</td></tr>
          <tr><td><code>scope_enforced</code></td><td>Always <code>true</code>; the proxy denies actions outside the intersected scopes.</td></tr>
        </tbody>
      </table>
      <p>
        Exchange is rate limited to 120 requests per minute per external agent. If the intersection is empty, Authab
        returns <code>422 no_scopes</code> rather than issuing a useless token.
      </p>

      <h2 id="revoke">5. Revoke</h2>
      <p>
        Either organization can revoke at any time with <code>authab.trust.revoke(id)</code>. Revoking sets the
        relationship to <code>revoked</code>, revokes the shadow agent, and adds it to the owner environment&apos;s
        signed <Link href="/docs/concepts/agent-identity-and-revocation">revocation list</Link>. Every authenticated
        request re-checks the relationship, so existing shadow tokens fail immediately with{" "}
        <code>401 trust_revoked</code>; offline verifiers see the revocation on their next list refresh.
      </p>
      <p>
        Revocation is permanent for that relationship. A new collaboration starts with a new invitation and a new shadow
        agent, so the old audit history stays attached to the old identity.
      </p>

      <h2 id="rules">Rules and limits</h2>
      <ul>
        <li><strong>Same environment type.</strong> Production trusts production; development trusts development. There is no dev-to-prod bridge.</li>
        <li><strong>Internal agents only.</strong> A shadow agent cannot itself be invited into a trust relationship.</li>
        <li><strong>Different organizations.</strong> Inviting your own organization&apos;s agent returns <code>same_organization</code>.</li>
        <li><strong>Public or limited visibility.</strong> Agents marked private cannot receive invitations.</li>
        <li><strong>One open relationship per pair.</strong> Revoke the old relationship before creating a new one.</li>
        <li><strong>No key handoff.</strong> The external agent never receives a shadow private key, and the shadow agent has none.</li>
      </ul>
      <Callout title="Approvals still apply">
        If a shadow agent&apos;s grant requires approval, the call waits for a human in the owner organization exactly
        like a local call. The external agent gets <code>202</code> with an approval id and polls the same idempotency
        key.
      </Callout>

      <h2 id="dashboard">In the dashboard</h2>
      <p>
        <Link href="/app/trust">Trust</Link> shows outbound invitations and inbound ones, with Accept, Decline and Revoke
        actions. The shadow agent, its grants and its traffic appear alongside your own agents.
      </p>
      <p>
        Related: <Link href="/docs/concepts/end-user-consent">end-user consent</Link>,{" "}
        <Link href="/docs/concepts/grants">grants</Link>,{" "}
        <Link href="/docs/concepts/policy">policy engine</Link>.
      </p>
    </DocsShell>
  );
}
