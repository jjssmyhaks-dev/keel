import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Agent identity and revocation",
  description:
    "The signed identity document every agent carries, how to verify it offline, and the pull endpoint that lists revocations.",
};

export default function AgentIdentityAndRevocationPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Agent identity and revocation"
      intro="Each agent carries a signed, versioned identity document that outside parties can verify with the platform's public keys long after the fact. A separate revocation list lets verifiers pull every revoked agent per environment without polling each one."
      updated="12 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#document", name: "Identity document" },
            { href: "#fields", name: "Fields" },
            { href: "#verify", name: "Verifying offline" },
            { href: "#issuance", name: "Issuance and doc_seq" },
            { href: "#visibility", name: "Visibility" },
            { href: "#revocation", name: "Revocation list" },
            { href: "#tooling", name: "CLI and SDK" },
          ]}
        />
      }
    >
      <h2 id="document">Identity document</h2>
      <p>
        Every agent has a current identity document: a JSON object signed as a compact EdDSA JWS with the platform
        signing key. The protected header names the key (<code>kid</code>), the algorithm (
        <code>EdDSA</code>) and the document type <code>agent-identity+jwt</code>, so it can be told apart from agent
        tokens even if both are pasted into the same verifier.
      </p>
      <p>
        Documents are generated at issuance time and kept current automatically. They cannot be reconstructed for past
        states, which is why the platform issues one on creation, status changes, key rotation and promotion, and
        repairs gaps nightly.
      </p>
      <pre>{`GET /api/v1/agents/:id/identity-document
Authorization: Bearer sk_live_...

{
  "agentId": "cm3x...",
  "docSeq": 3,
  "document": {
    "v": 1,
    "iss": "https://api.authab.dev",
    "iat": 1762900000,
    "doc_seq": 3,
    "agent_id": "cm3x...",
    "key_fingerprint": "SHA256:...",
    "public_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
    "org_ref": "9f2c1d4e5a6b7c8d9e0f1a2b",
    "environment": "production",
    "status": "active",
    "visibility": "public",
    "created_at": "2026-10-02T09:14:00.000Z"
  },
  "jws": "eyJhbGciOiJFZERTQSIsImtpZCI6...",
  "issuerKeyId": "k_2026_10",
  "issuedAt": "2026-11-12T00:00:00.000Z"
}`}</pre>

      <h2 id="fields">Fields</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>agent_id</code></td>
            <td>The stable identifier. The fingerprint rotates with the key, so it is never the primary identity.</td>
          </tr>
          <tr>
            <td><code>key_fingerprint</code></td>
            <td>The agent&apos;s current key fingerprint at issuance.</td>
          </tr>
          <tr>
            <td><code>public_jwk</code></td>
            <td>The current public key as an OKP Ed25519 JWK, so verifiers do not have to fetch it separately.</td>
          </tr>
          <tr>
            <td><code>org_ref</code></td>
            <td>
              A pseudonymous organization reference: the first 24 hex characters of an HMAC over the organization id,
              keyed with HKDF-derived material. Stable per organization, different between organizations, and not
              reversible. The organization name and id never appear in the document.
            </td>
          </tr>
          <tr>
            <td><code>environment</code></td>
            <td><code>development</code> or <code>production</code>.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>active</code>, <code>paused</code>, <code>suspended</code> or <code>revoked</code>. Any unknown value is normalised to <code>revoked</code>.</td>
          </tr>
          <tr>
            <td><code>visibility</code></td>
            <td><code>public</code>, <code>limited</code> or <code>private</code>. Stored and embedded now; enforcement arrives with the public endpoint.</td>
          </tr>
          <tr>
            <td><code>doc_seq</code></td>
            <td>Starts at 1 and increments on every re-issue. Verifiers should reject a document older than one they have already accepted for the same agent.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="verify">Verifying offline</h2>
      <p>
        The document verifies with the keys already published at <code>/api/v1/jwks</code> and{" "}
        <code>/.well-known/jwks.json</code>. Check the header type, verify the signature with{" "}
        <code>jose.jwtVerify</code> (or any EdDSA library), then compare claims against your own records.
      </p>
      <pre>{`import { jwtVerify, createRemoteJWKSet } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.authab.dev/api/v1/jwks"));
const { payload, protectedHeader } = await jwtVerify(jws, jwks, {
  issuer: "https://api.authab.dev",
  algorithms: ["EdDSA"],
});
if (protectedHeader.typ !== "agent-identity+jwt") throw new Error("not an identity document");`}</pre>
      <Callout tone="note" title="Key rotation">
        Retired public keys stay verifiable when published in <code>AUTHAB_JWKS_PREVIOUS</code>. The rotation procedure
        is in <code>docs/operations/key-rotation.md</code>: publish the outgoing public JWK first, then swap the signing
        key. Documents signed by the retired key keep verifying.
      </Callout>

      <h2 id="issuance">Issuance and doc_seq</h2>
      <p>
        The platform issues a document after agent creation, pause, resume, suspend, revoke, kill, key rotation,
        promotion to production and any visibility change. Re-issuing supersedes the previous row, so exactly one
        current document exists per agent. The nightly cron re-issues any document whose embedded status, fingerprint or
        visibility no longer matches the agent row.
      </p>
      <p>
        Issuance never blocks the user&apos;s action: if signing fails, the failure is logged and recorded as{" "}
        <code>identity.issue_failed</code> in the audit log, and the next cron pass repairs it.
      </p>

      <h2 id="visibility">Visibility</h2>
      <p>
        <code>verificationVisibility</code> is set per agent with <code>PATCH /api/v1/agents/:id</code> and embedded in
        each new document. At launch it is advisory metadata only; the public verification endpoint that enforces it
        arrives in a later release.
      </p>

      <h2 id="revocation">Revocation list</h2>
      <p>
        Revocations are written immediately when an agent is killed, revoked or deleted, with a fixed reason code:
        <code>owner_revoked</code>, <code>compromised</code>, <code>abuse</code> or <code>expired</code>. Pause and
        suspend are reversible and are not revocations.
      </p>
      <p>
        Verifiers pull the list on an interval and cache the ETag. The endpoint is scoped to the caller&apos;s own
        environment: one customer never sees another&apos;s agents.
      </p>
      <pre>{`GET /api/v1/revocations?since=2026-11-01T00:00:00Z&limit=1000
Authorization: Bearer sk_...
If-None-Match: "5d41402a..."

{
  "jws": "eyJhbGciOiJFZERTQSIsInR5cCI6...",
  "etag": "5d41402a...",
  "next": "cm3x_2026-11-12T00:04:00.000Z"
}`}</pre>
      <ul>
        <li>
          <code>since</code> (optional ISO time), <code>limit</code> (default 1000, max 5000) and <code>cursor</code>{" "}
          page through entries; each entry appears exactly once.
        </li>
        <li>
          The body is signed as <code>agent-revocations+jwt</code> with payload{" "}
          <code>{`{ v, iss, iat, exp, environment, revoked: [{ agent_id, revoked_at, reason }] }`}</code>.{" "}
          <code>exp</code> is ten minutes after <code>iat</code>.
        </li>
        <li>
          <code>etag</code> is the SHA-256 of the canonical JSON of the revoked list alone, so it does not change when
          only <code>iat</code> and <code>exp</code> do. Send it back as <code>If-None-Match</code> to get a{" "}
          <code>304</code>.
        </li>
        <li>
          Responses carry <code>Cache-Control: private, max-age=30</code>.
        </li>
      </ul>

      <h2 id="tooling">CLI and SDK</h2>
      <pre>{`# print the document and its JWS
authab agents identity agt_...

# create with a type
authab agents create --name "Atlas" --type research`}</pre>
      <pre>{`const identity = await authab.agents.identityDocument("agt_...");
console.log(identity.document.status, identity.jws);`}</pre>
      <p>
        Agent types (<code>support</code>, <code>sales</code>, <code>finance</code>, <code>coding</code>,{" "}
        <code>research</code>, <code>operations</code>, <code>data</code>, <code>other</code>) are accepted on create
        and update in the API, dashboard, CLI and SDK. They group policy suggestions and reputation; they never grant
        access. See <Link href="/docs/concepts/identity">agent identity</Link> for keys and tokens.
      </p>
    </DocsShell>
  );
}
