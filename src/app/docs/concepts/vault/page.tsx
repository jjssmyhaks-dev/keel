import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Credential vault",
  description: "Envelope-encrypted credentials that agents can use but never read.",
};

export default function VaultPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Credential vault"
      intro="Most agent incidents start with a secret in a prompt, a .env file or a tool argument. Authab removes the secret from the agent's reach: credentials are encrypted at rest, injected only inside the proxy, and never returned by any API."
      updated="11 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#model", name: "Encryption model" },
            { href: "#lifecycle", name: "Credential lifecycle" },
            { href: "#connect", name: "OAuth connect" },
            { href: "#rotation", name: "Rotation" },
            { href: "#redaction", name: "Redaction" },
            { href: "#health", name: "Health checks" },
            { href: "#boundaries", name: "Trust boundaries" },
          ]}
        />
      }
    >
      <h2 id="model">Encryption model</h2>
      <p>
        Authab uses envelope encryption with three levels: a deployment master key, a per-project key, and a fresh
        data-encryption key for every credential. Secrets are sealed with AES-256-GCM; the data key is wrapped by the
        project key, and only the wrapped key and ciphertext are stored.
      </p>
      <pre>{`master key (deployment, never in the database)
  └─ project key (one per project)
       └─ data key (one per credential, random)
            └─ AES-256-GCM(secret, data key)`}</pre>
      <p>
        Decryption happens only inside the proxy, in memory, immediately before a provider call. The plaintext is not
        written to logs, audit events or approval payloads. Revoking a credential destroys its wrapped data key, which
        makes the ciphertext unrecoverable even if a database backup survives.
      </p>
      <Callout title="Deployments and key custody">
        The master key is supplied through the deployment environment at boot and is never accepted from a request or
        stored in the database. Local development can generate a key file instead of setting one.
      </Callout>

      <h2 id="lifecycle">Credential lifecycle</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
            <th>Proxy behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>healthy</code></td><td>The last provider call succeeded.</td><td>Calls allowed if policy allows.</td></tr>
          <tr><td><code>unverified</code></td><td>Stored but not yet exercised against the provider.</td><td>Calls allowed if policy allows.</td></tr>
          <tr><td><code>expiring</code></td><td>Expiry is within the warning window.</td><td>Allowed, but flagged in the vault and notifications.</td></tr>
          <tr><td><code>broken</code></td><td>Provider rejected the credential with 401 or 403.</td><td>Denied with <code>credential_unhealthy</code> until rotated.</td></tr>
          <tr><td><code>revoked</code></td><td>A human revoked it.</td><td>Denied permanently. Grants referencing it are inert.</td></tr>
        </tbody>
      </table>
      <p>
        Each credential stores connector slug, auth type, a masked hint such as <code>••••8f2a</code>, free-form
        metadata, optional expiry, last-used timestamp and health history. The masked hint is the only part of the
        secret any human or API sees after creation.
      </p>

      <h2 id="connect">OAuth connect</h2>
      <p>
        For the eleven providers with a built-in OAuth app, the vault can open the provider&apos;s consent screen and store
        the resulting tokens without anyone pasting a secret. Connect uses PKCE and a signed, single-use state cookie;
        the access token, refresh token, scopes and expiry are sealed with the same envelope encryption as any other
        credential.
      </p>
      <pre>{`GET  /api/connect/google/start       → 302 to the provider
GET  /api/connect/google/callback    → stores the sealed token set
POST /api/v1/credentials/:id/refresh → rotates tokens now`}</pre>
      <p>
        The scheduler refreshes OAuth credentials ten minutes before expiry, and the proxy refreshes again on demand
        when a token is inside its five-minute safety margin. A rotated refresh token is written back before the call
        proceeds. Transient provider failures defer the refresh and keep the current token usable; a permanent failure
        such as <code>invalid_grant</code> marks the connection <code>broken</code> and notifies the environment owners.
      </p>
      <p>
        OAuth apps can be configured per environment in the dashboard or supplied through{" "}
        <code>CONNECT_&lt;PROVIDER&gt;_CLIENT_ID</code> and <code>CONNECT_&lt;PROVIDER&gt;_CLIENT_SECRET</code>. Token
        endpoints are validated against SSRF: HTTPS only in production, no credentials in the URL, and no private or
        loopback resolution.
      </p>

      <h2 id="rotation">Rotation</h2>
      <p>
        Rotation replaces the ciphertext and data key in place. The credential id, grants and audit history stay the
        same, so agents keep working without a redeploy.
      </p>
      <pre>{`PATCH /api/v1/credentials/:id
{ "secret": { "accessToken": "xoxb-new-token" }, "expiresAt": "2027-01-31T00:00:00.000Z" }

# 200 → { id, status: "unverified", maskedHint: "••••9d11", ... }`}</pre>
      <p>
        Every rotation writes a <code>credential.rotated</code> audit event without the secret and marks the connection{" "}
        <code>unverified</code> again; the next successful provider call records it as <code>healthy</code>. Expiring
        credentials should be rotated before the provider starts rejecting them — the vault warns three days ahead.
      </p>

      <h2 id="redaction">Redaction</h2>
      <p>
        Redaction has two directions. Inbound, fields listed on the connector (for example{" "}
        <code>token</code>, <code>authorization</code>, <code>text</code> for Slack) are stripped from approval payloads
        before they are stored, so a human can approve intent without seeing message bodies. Outbound, provider
        responses are scanned for the exact credential strings (8 characters or longer) and replaced with{" "}
        <code>[redacted]</code> before reaching the agent. The call&apos;s trust record stores how many replacements
        were made.
      </p>
      <p>
        Connector definitions declare exactly which fields are sensitive; see{" "}
        <Link href="/docs/connectors">the connector catalogue</Link>. Redaction is exact-string matching, not semantic
        classification, and is best-effort on free-form provider responses: never rely on it as your only control for
        secrets you inject into prompt context. Each call&apos;s{" "}
        <Link href="/docs/concepts/audit#trust">trust view</Link> shows what was injected and redacted.
      </p>

      <h2 id="health">Health checks</h2>
      <p>
        Health combines scheduled probes with real traffic. The five-minute scheduler runs a real, read-only provider
        probe for due connections (24 hours by default; connectors without a safe read action are skipped), and{" "}
        <code>POST /api/v1/credentials/:id/check</code> runs the same probe on demand. A successful probe marks the
        connection <code>healthy</code> and clears a previous break; a 401/403 or provider auth error marks it{" "}
        <code>broken</code>, records a health event and notifies the environment owners; network errors and 5xx
        responses are recorded as a warning and do not by themselves condemn the credential.
      </p>
      <p>
        Normal proxy traffic feeds the same state: a provider rejection marks the credential broken, a 2xx marks it
        healthy, and every call refreshes <code>lastUsedAt</code>. Refreshing an OAuth connection also records a{" "}
        <code>refreshed</code> health event.
      </p>

      <h2 id="boundaries">Trust boundaries</h2>
      <ul>
        <li>Agents never receive credential material, only proxied results.</li>
        <li>API keys that manage the vault are secret keys and must stay server-side.</li>
        <li>Dashboard sessions are httpOnly, database-backed and revocable from settings.</li>
        <li>Audit events never contain plaintext secrets or full provider responses.</li>
        <li>Approval links are signed tokens scoped to a single request and expire with it.</li>
      </ul>
      <p>
        Read-only roles can see metadata and masked hints but cannot create, rotate or revoke credentials. Approval
        payloads are visible to approvers because deciding requires context; the redaction rules above limit what that
        context contains.
      </p>
    </DocsShell>
  );
}
