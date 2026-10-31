import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Agent identity",
  description: "Ed25519 keypairs, short-lived EdDSA JWTs, revocation and delegation for AI agents.",
};

export default function IdentityPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Agent identity"
      intro="A service account and an AI agent look similar until the agent starts making decisions. Keel treats the agent as a cryptographic principal: a keypair, a fingerprint, short-lived credentials, and a status a human can change in one click."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#principal", name: "What an agent is" },
            { href: "#keys", name: "Key custody" },
            { href: "#tokens", name: "Tokens" },
            { href: "#claims", name: "Claims" },
            { href: "#revocation", name: "Revocation" },
            { href: "#delegation", name: "Delegation" },
            { href: "#jwks", name: "Verifying offline" },
          ]}
        />
      }
    >
      <h2 id="principal">What an agent is</h2>
      <p>
        An agent belongs to exactly one environment. It has a name unique within that environment, an owner (a human
        teammate), optional tags and framework metadata, and a status: <code>active</code>, <code>paused</code>,{" "}
        <code>suspended</code> or <code>revoked</code>. Only <code>active</code> agents can receive tokens.
      </p>
      <p>
        Every agent has an Ed25519 keypair. The public key is stored in plaintext; the fingerprint is the SHA-256 of
        the public key and is stable for the lifetime of that key. Rotating a key produces a new key id and
        fingerprint while keeping the agent&apos;s grants and audit history.
      </p>

      <h2 id="keys">Key custody</h2>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Private key lives</th>
            <th>Use when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>client</code></td>
            <td>Your runtime or secret manager</td>
            <td>The agent proves possession by signing a Keel challenge. Keel never sees the private key.</td>
          </tr>
          <tr>
            <td><code>platform</code></td>
            <td>Encrypted in Keel&apos;s vault</td>
            <td>You want Keel to mint tokens on the agent&apos;s behalf. Simpler; still revocable instantly.</td>
          </tr>
        </tbody>
      </table>
      <p>
        When you register an agent without supplying a public key, Keel generates one and returns the private key{" "}
        <strong>once</strong> in the creation response. If you lose it in client mode, rotate the key rather than
        recreating the agent — grants, audit history and approvals stay attached.
      </p>

      <h2 id="tokens">Tokens</h2>
      <p>
        Agents authenticate to the proxy with an EdDSA JWT signed by Keel. Default TTL is 300 seconds; the API clamps
        requests to between 60 and 3600 seconds. The token is bound to the agent, environment, project and organisation,
        and carries the union of scopes from that agent&apos;s active grants.
      </p>
      <pre>{`POST /api/v1/agents/:agentId/token
Authorization: Bearer sk_...

{ "ttl": 300 }

200 {
  "token": "eyJhbGciOiJFZERTQSIsImtpZCI6...",
  "tokenId": "tok_...",
  "expiresIn": 300,
  "expiresAt": "2026-10-31T00:15:00.000Z"
}`}</pre>
      <p>
        Behind the scenes Keel records a <code>token.issued</code> audit event with the TTL, scopes and whether the
        token was minted by signature or by the platform. Token issuance is rate-limited per agent.
      </p>

      <h2 id="claims">Claims</h2>
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>iss</code></td><td><code>https://keel.dev</code> (configurable per deployment)</td></tr>
          <tr><td><code>aud</code></td><td><code>keel-api</code></td></tr>
          <tr><td><code>sub</code></td><td>Agent id</td></tr>
          <tr><td><code>jti</code></td><td>Token id, used for revocation and introspection</td></tr>
          <tr><td><code>env</code> / <code>project</code> / <code>org</code></td><td>Tenancy boundary for the token</td></tr>
          <tr><td><code>scopes</code></td><td>Union of granted action names, including globs</td></tr>
          <tr><td><code>actor</code></td><td><code>{"{ sub, act }"}</code> when a human requested the token</td></tr>
        </tbody>
      </table>
      <p>
        Keel re-evaluates policy on every request. The <code>scopes</code> claim is a fast pre-check; it never replaces
        the grant lookup, so a grant edited after issuance takes effect immediately.
      </p>

      <h2 id="revocation">Revocation</h2>
      <p>
        Token revocation is immediate and does not wait for expiry:
      </p>
      <pre>{`POST /api/v1/tokens/revoke        { "tokenId": "tok_...", "reason": "incident-441" }
POST /api/v1/tokens/introspect    { "token": "eyJ..." }
# → { active: false, reason: "revoked", tokenId }`}</pre>
      <p>
        Agent-level actions are stronger. <strong>Pause</strong> stops new calls but keeps grants; <strong>suspend</strong>{" "}
        does the same and flags the agent in the dashboard; <strong>kill</strong> revokes every token, retires keys and
        closes open approvals. Revocation is permanent — create a new agent instead.
      </p>
      <Callout tone="warning" title="Revocation is checked before policy">
        A revoked agent cannot call a connector even if its grant is still present. The policy engine denies before
        decrypting anything.
      </Callout>

      <h2 id="delegation">Delegation</h2>
      <p>
        Some agents act on behalf of another agent — a research agent hands a narrow Slack task to a summariser, which
        posts the digest. Keel records that relationship as a delegation: parent, child, an explicit scope list, a
        resource subset, an optional call cap, a depth limit and an expiry.
      </p>
      <p>
        A delegation narrows access, never broadens it. The child still needs its own grant for the connection it calls;
        the delegation documents who authorised the work and shows up on both agents in the dashboard, so an operator
        can trace an action back through the chain. Expired delegations are kept for the record but no longer describe
        an active relationship.
      </p>
      <Callout title="Delegation is not shared credentials">
        The child never borrows the parent&apos;s token or secret. It receives its own identity and its own grant.
        Delegation exists for accountability, not for privilege escalation.
      </Callout>

      <h2 id="jwks">Verifying offline</h2>
      <p>
        Keel publishes its public signing keys at <a href="/api/v1/jwks">/api/v1/jwks</a>. If you have services that
        accept agent tokens directly, verify them locally against that JWKS and check <code>aud</code>,{" "}
        <code>iss</code> and expiry. Do not cache keys indefinitely — refresh at least daily and on unknown <code>kid</code>.
      </p>
      <pre>{`curl https://api.keel.dev/v1/jwks
# { "keys": [{ "kty": "OKP", "crv": "Ed25519", "x": "...", "kid": "...", "alg": "EdDSA", "use": "sig" }] }`}</pre>
      <p>
        Offline verification proves the token was minted by Keel. It cannot tell you whether a grant was revoked seconds
        ago — for that, call introspection or route the call through the proxy. See{" "}
        <Link href="/docs/api">the API reference</Link> for the exact endpoints.
      </p>
    </DocsShell>
  );
}
