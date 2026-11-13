import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "End-user consent",
  description: "Let an agent act for your customers with a hosted consent screen, one-time codes and short-lived, consent-scoped tokens.",
};

export default function EndUserConsentPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="End-user consent"
      intro="When an agent acts for your customer rather than your company, the customer grants the access. Authab hosts the permission screen, records what was approved, connects the provider accounts, and issues tokens that die when the consent does."
      updated="13 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#when", name: "When to use it" },
            { href: "#flow", name: "The flow" },
            { href: "#create", name: "1. Create a request" },
            { href: "#approve", name: "2. The hosted screen" },
            { href: "#callback", name: "3. Handle the callback" },
            { href: "#proxy", name: "4. Call the proxy" },
            { href: "#tokens", name: "Token lifetime" },
            { href: "#revocation", name: "Revocation" },
            { href: "#safety", name: "Safety rules" },
            { href: "#dashboard", name: "In the dashboard" },
            { href: "#example", name: "Complete example" },
          ]}
        />
      }
    >
      <h2 id="when">When to use it</h2>
      <p>
        Use end-user consent when the connection belongs to your customer: their Slack workspace, their Google Drive,
        their Notion. Organization grants remain the right tool for company-owned credentials. The two share the same
        proxy, policy engine and audit trail — the difference is who is allowed to approve, and whose token can reach
        which connection.
      </p>

      <h2 id="flow">The flow</h2>
      <pre>{`your backend                Authab                     end user
     │  POST /consent/requests │                           │
     │────────────────────────▶│                           │
     │        { id, url }      │                           │
     │◀────────────────────────│                           │
     │  redirect to url        │                           │
     │────────────────────────────────────────────────────▶│
     │                         │  approve + connect Slack  │
     │                         │◀──────────────────────────│
     │  302 redirectUri?code=…&state=…                     │
     │◀────────────────────────────────────────────────────│
     │  POST /consent/token    │                           │
     │────────────────────────▶│                           │
     │  { agentToken, scopes } │                           │
     │◀────────────────────────│                           │
     │  proxy call with the consent-scoped token           │
     │────────────────────────────────────────────────────▶│`}</pre>
      <p>
        The agent never sees the end user&apos;s provider password, and your backend never sees the provider token. Authab
        stores it in the vault, keyed to that end user.
      </p>

      <h2 id="create">1. Create a request</h2>
      <p>
        Call <code>POST /v1/consent/requests</code> with a secret key. Scopes are action patterns;{" "}
        <code>slack.post_message</code> is one action, <code>slack.*</code> is a group. You may offer several durations
        and let the end user choose.
      </p>
      <pre>{`import { Authab } from "@authab/sdk";

const authab = new Authab(process.env.AUTHAB_API_KEY!);

const request = await authab.consent.createRequest({
  agentId: agent.id,
  endUser: { externalUserId: "cust_8812", email: "sam@example.com" },
  scopes: ["slack.post_message", "slack.read_channel_history"],
  redirectUri: "https://app.example.com/authab/callback",
  state: "onboarding-8812",
  durationOptions: ["session", "30d"],
});

res.redirect(request.url); // hosted consent screen`}</pre>
      <p>
        The request is pending for 30 minutes by default (5–1440 configurable). Before the request is accepted, Authab
        checks the project&apos;s consent settings in <strong>Settings → Consent</strong>: product name, allowed redirect
        URIs, allowed scopes, a risk ceiling and the maximum grant duration. Every failure maps to a stable error code:
      </p>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>branding_incomplete</code></td><td>Set the product name and at least one redirect URI first.</td></tr>
          <tr><td><code>redirect_not_allowed</code></td><td>The URI is not on the project&apos;s allowlist, or not HTTPS.</td></tr>
          <tr><td><code>scope_unknown</code>, <code>scope_not_allowed</code></td><td>The scope matches no action, or falls outside the project&apos;s allowed patterns.</td></tr>
          <tr><td><code>scope_risk_too_high</code></td><td>The scope includes actions above the project&apos;s risk ceiling.</td></tr>
          <tr><td><code>connector_not_oauth</code></td><td>The connector cannot be connected by an end user at launch.</td></tr>
          <tr><td><code>agent_not_internal</code></td><td>Consent can only be requested for your own internal agents.</td></tr>
          <tr><td><code>agent_inactive</code></td><td>Resume the agent before requesting consent.</td></tr>
        </tbody>
      </table>

      <h2 id="approve">2. The hosted screen</h2>
      <p>
        The consent page names the product and the agent, groups the requested actions in plain language, and shows what
        each group allows. The end user can drop whole groups, choose a duration, then approve or decline. Declining
        redirects with <code>error=access_denied</code>; the agent receives nothing.
      </p>
      <p>
        If the request includes scopes for a provider the end user has not connected yet, the page asks them to connect
        it first. Authab runs the provider&apos;s OAuth flow and stores the resulting credential against that end user
        only — it is never visible to your organization-level keys or other end users.
      </p>
      <Callout title="No iframe, no embedded password form">
        Authab hosts the screen on its own domain, like a bank&apos;s OAuth page. Do not embed it in an iframe and never
        ask for provider passwords yourself.
      </Callout>

      <h2 id="callback">3. Handle the callback</h2>
      <p>
        On approval, Authab redirects to your <code>redirectUri</code> with <code>code</code> and your{" "}
        <code>state</code>. Exchange the code server-side with the same redirect URI:
      </p>
      <pre>{`// GET /authab/callback?code=...&state=onboarding-8812
const grant = await authab.consent.exchangeCode({
  code: req.query.code,
  redirectUri: "https://app.example.com/authab/callback",
});

// grant = { agentToken, expiresIn, consentId, endUserId, scopes }`}</pre>
      <p>
        The code is single-use and expires five minutes after approval. A second exchange returns{" "}
        <code>409 code_used</code>; an expired code returns <code>409 code_expired</code>; a consent revoked in between
        returns <code>409 consent_inactive</code>. Verify <code>state</code> against the value you stored before calling
        the exchange.
      </p>

      <h2 id="proxy">4. Call the proxy</h2>
      <p>
        The returned token is an ordinary agent token with two extra claims: <code>consent</code> and{" "}
        <code>end_user</code>. Use it exactly like any other agent token. The connection is selected automatically from
        the consent — never pass an organization credential id with an end-user token.
      </p>
      <pre>{`const result = await fetch("https://api.authab.dev/v1/proxy/slack", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${grant.agentToken}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "slack.post_message",
    resource: "support-billing",
    input: { channel: "C012345", text: "Your refund was processed." },
  }),
});`}</pre>
      <p>
        Policy still applies: grants created by the consent constrain actions and time. If a workspace blocks an
        end-user call or a scope was not approved, the proxy denies it with <code>scope_not_granted</code> or{" "}
        <code>policy_denied</code>.
      </p>

      <h2 id="tokens">Token lifetime</h2>
      <p>
        Consent tokens live one hour. Your backend can mint a new one for as long as the consent is active with{" "}
        <code>POST /v1/consent/:id/token</code> — no second redirect:
      </p>
      <pre>{`const next = await authab.consent.mintToken(grant.consentId);`}</pre>
      <p>
        Every authenticated request re-checks the consent: it must exist, belong to the same agent, not be revoked and
        not be expired. A revoked consent rejects the token on its next use with <code>401 consent_revoked</code>, even
        if the JWT itself has not expired. <code>lastUsedAt</code> is updated at most once a minute so the end-user view
        stays meaningful without a write per call.
      </p>

      <h2 id="revocation">Revocation</h2>
      <p>Either party can end access, and all three paths expire the grants that came from the consent:</p>
      <ul>
        <li>The end user opens their control center and revokes the product or a single permission group.</li>
        <li>Your backend calls <code>authab.consent.revoke(consentId, {"{"} reason: "customer_revoked" {"}"})</code>.</li>
        <li>A teammate with the right role revokes it from <Link href="/app/end-users">End users</Link> in the dashboard.</li>
      </ul>
      <p>
        Revocation writes the <code>consent.revoked</code> audit event and dispatches the{" "}
        <code>consent.revoked</code> webhook. Expiry works the same way without an actor: once <code>expiresAt</code>{" "}
        passes, tokens stop being mintable and existing ones fail on the next call.
      </p>
      <p>
        To give an end user a way back in without email, issue a control-center link. It is valid for 15 minutes and
        only opens the end user&apos;s own page:
      </p>
      <pre>{`const link = await authab.endUsers.controlLink("cust_8812");
// link = { url, expiresAt } — show it in your app or support flow`}</pre>

      <h2 id="safety">Safety rules</h2>
      <ul>
        <li>
          <strong>Internal agents only.</strong> External agents admitted through a trust relationship cannot request
          end-user consent.
        </li>
        <li>
          <strong>Connections are isolated.</strong> An end-user token can only use that end user&apos;s connections
          (<code>403 credential_not_owned</code>); an organization token cannot even see them (
          <code>404 credential_not_found</code>).
        </li>
        <li>
          <strong>Nothing sensitive in telemetry.</strong> Audit events store the end-user id and your external id,
          never the email address; agent events carry <code>endUserId</code> but no request content.
        </li>
        <li>
          <strong>Recipient data requests.</strong> End users can export or delete their data from the control center.
          Deleting an end user invalidates their consents immediately.
        </li>
      </ul>

      <h2 id="dashboard">In the dashboard</h2>
      <p>
        <Link href="/app/settings/consent">Settings → Consent</Link> configures branding, allowed scopes, redirect URIs,
        the risk ceiling and maximum duration. <Link href="/app/end-users">End users</Link> lists every end user with
        their consents, connections and data requests, and can issue a control link or revoke access.
      </p>

      <h2 id="example">Complete example</h2>
      <p>
        A minimal Express app: create the request, redirect, verify state, exchange the code, call Slack, and mint
        tokens later. It assumes <code>AUTHAB_API_KEY</code> and <code>AGENT_ID</code> are set, and the redirect URI is
        registered in Settings → Consent.
      </p>
      <pre>{`import express from "express";
import { Authab } from "@authab/sdk";

const authab = new Authab(process.env.AUTHAB_API_KEY!);
const app = express();
const states = new Map(); // demo only — use your session store

app.get("/connect-slack", async (req, res) => {
  const state = crypto.randomUUID();
  states.set(state, req.user.id);
  const request = await authab.consent.createRequest({
    agentId: process.env.AGENT_ID!,
    endUser: { externalUserId: req.user.id, email: req.user.email },
    scopes: ["slack.post_message"],
    redirectUri: "https://app.example.com/authab/callback",
    state,
    durationOptions: ["session", "30d"],
  });
  res.redirect(request.url);
});

app.get("/authab/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(\`Consent not granted: \${error}\`);
  if (!states.has(state)) return res.status(400).send("Unknown state");
  states.delete(state);

  const grant = await authab.consent.exchangeCode({
    code,
    redirectUri: "https://app.example.com/authab/callback",
  });
  // store grant.consentId with the user, never the raw token

  await fetch("https://api.authab.dev/v1/proxy/slack", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${grant.agentToken}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "slack.post_message",
      resource: "support-billing",
      input: { channel: "C012345", text: "You're connected." },
    }),
  });

  res.send("Slack connected.");
});

app.listen(3000);`}</pre>
      <p>
        Related: <Link href="/docs/concepts/cross-org-trust">cross-organization trust</Link>,{" "}
        <Link href="/docs/concepts/vault">credential vault</Link>,{" "}
        <Link href="/docs/concepts/agent-events">agent events</Link>.
      </p>
    </DocsShell>
  );
}
