import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Credential vault — Keel docs",
  description: "Envelope-encrypted credentials that agents can use but never read.",
};

export default function VaultPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Credential vault"
      intro="Most agent incidents start with a secret in a prompt, a .env file or a tool argument. Keel removes the secret from the agent's reach: credentials are encrypted at rest, injected only inside the proxy, and never returned by any API."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#model", name: "Encryption model" },
            { href: "#lifecycle", name: "Credential lifecycle" },
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
        Keel uses envelope encryption with three levels: a deployment master key, a per-project key, and a fresh
        data-encryption key for every credential. Secrets are sealed with AES-256-GCM; the data key is wrapped by the
        project key, and only the wrapped key and ciphertext are stored.
      </p>
      <pre>{`master key (deployment, never in the database)
  └─ project key (one per project)
       └─ data key (one per credential, random)
            └─ AES-256-GCM(secret, data key)`}</pre>
      <p>
        Decryption happens only inside the proxy, in memory, immediately before a provider call. The plaintext is not
        written to logs, audit events or approval payloads. Deleting a credential destroys its wrapped data key, which
        makes the ciphertext unrecoverable even if a database backup survives.
      </p>
      <Callout title="Deployments and key custody">
        In the hosted product the master key lives in a managed KMS and is loaded through a secrets provider at boot.
        Self-hosted deployments can supply their own master key; the application never accepts it from a request.
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
          <tr><td><code>healthy</code></td><td>Last check succeeded, or never checked.</td><td>Calls allowed if policy allows.</td></tr>
          <tr><td><code>expiring</code></td><td>Expiry is within the warning window.</td><td>Allowed, but flagged in the vault and notifications.</td></tr>
          <tr><td><code>broken</code></td><td>Provider rejected the credential, or health check failed.</td><td>Denied with <code>credential_unhealthy</code> until rotated.</td></tr>
          <tr><td><code>revoked</code></td><td>A human revoked it.</td><td>Denied permanently. Grants referencing it are inert.</td></tr>
        </tbody>
      </table>
      <p>
        Each credential stores connector slug, auth type, a masked hint such as <code>••••8f2a</code>, free-form
        metadata, optional expiry, last-used timestamp and health history. The masked hint is the only part of the
        secret any human or API sees after creation.
      </p>

      <h2 id="rotation">Rotation</h2>
      <p>
        Rotation replaces the ciphertext and data key in place. The credential id, grants and audit history stay the
        same, so agents keep working without a redeploy.
      </p>
      <pre>{`PATCH /api/v1/credentials/:id
{ "secret": { "accessToken": "xoxb-new-token" }, "expiresAt": "2027-01-31T00:00:00.000Z" }

# 200 → { id, status: "healthy", maskedHint: "••••9d11", ... }`}</pre>
      <p>
        Every rotation writes a <code>credential.rotated</code> audit event without the secret, and clears a{" "}
        <code>broken</code> status. Expiring credentials should be rotated before the provider starts rejecting them —
        the vault warns three days ahead.
      </p>

      <h2 id="redaction">Redaction</h2>
      <p>
        Redaction has two directions. Inbound, fields listed on the connector (for example{" "}
        <code>token</code>, <code>authorization</code>, <code>text</code> for Slack) are stripped from approval payloads
        before they are stored, so a human can approve intent without seeing message bodies. Outbound, provider
        responses are scanned for the credential value and replaced with <code>[redacted]</code> before reaching the
        agent.
      </p>
      <p>
        Connector definitions declare exactly which fields are sensitive; see{" "}
        <Link href="/docs/connectors">the connector catalogue</Link>. Redaction is best-effort on free-form provider
        responses: never rely on it as your only control for secrets you inject into prompt context.
      </p>

      <h2 id="health">Health checks</h2>
      <p>
        Keel records a health event on every failed provider call. A 401 or 403 from the provider marks the credential{" "}
        <code>broken</code> and notifies the environment owner; a successful call refreshes <code>lastUsedAt</code>. You
        can also run a check from the credential page, which performs the connector&apos;s cheapest read action.
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
