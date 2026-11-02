import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Give AI agents a short-lived identity, a credential vault they can use but never read, and permissions a human approved.",
};

const pillars = [
  {
    title: "Identity",
    body: "Every agent gets an Ed25519 keypair, a fingerprint, and short-lived EdDSA JWTs. Rotate, suspend or kill an agent without touching the services it calls.",
    href: "/docs/concepts/identity",
    label: "Agent identity",
  },
  {
    title: "Vault",
    body: "Provider secrets are envelope-encrypted at rest. The proxy injects them at execution time, so agents never see the raw credential.",
    href: "/docs/concepts/vault",
    label: "Credential vault",
  },
  {
    title: "Governance",
    body: "Grants scope an agent to named actions, resources and time windows. Risky calls route to a human with a signed approval link.",
    href: "/docs/concepts/policy",
    label: "Policy engine",
  },
];

const paths = [
  { name: "Quickstart", detail: "First agent to first governed call in ten minutes", href: "/docs/quickstart" },
  { name: "API reference", detail: "REST endpoints, errors, idempotency and pagination", href: "/docs/api" },
  { name: "TypeScript SDK", detail: "keel.agents, keel.vault, keel.proxy", href: "/docs/sdk" },
  { name: "Connectors", detail: "Nine integrations, with exact actions and scopes", href: "/docs/connectors" },
];

export default function DocsOverviewPage() {
  return (
    <DocsShell
      eyebrow="Documentation"
      title="Identity, vault and governance. In one API."
      intro="Keel sits between your agents and the services they call. It issues identity, holds the secrets, evaluates policy on every request, and writes an append-only record of what happened."
      updated="31 October 2026"
      aside={
        <DocsAside
          links={[
            { href: "#pillars", name: "The three layers" },
            { href: "#request-path", name: "The request path" },
            { href: "#surfaces", name: "Surfaces" },
            { href: "#paths", name: "Start here" },
          ]}
        />
      }
    >
      <h2 id="pillars">The three layers</h2>
      <p>
        Keel replaces three things teams usually build twice: an identity system for non-humans, a secrets store with
        per-agent access, and an audit log that survives a bad deploy. They share one data model, so a revocation in
        identity immediately blocks the vault and the policy engine.
      </p>

      <div className="not-prose my-8 grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-3">
        {pillars.map((pillar) => (
          <Link
            key={pillar.title}
            href={pillar.href}
            className="group bg-background p-5 transition-colors hover:bg-foreground/[0.03]"
          >
            <p className="mono-label text-foreground/35">{pillar.label}</p>
            <p className="mt-3 font-display text-2xl leading-none">{pillar.title}</p>
            <p className="mt-3 text-[13px] leading-relaxed text-foreground/60">{pillar.body}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-[11px] text-foreground/45 group-hover:text-foreground">
              Read <ArrowUpRight className="size-3" />
            </span>
          </Link>
        ))}
      </div>

      <h2 id="request-path">The request path</h2>
      <p>
        An agent never talks to Slack, Stripe or GitHub directly. It calls the Keel proxy with a five-minute JWT. Keel
        verifies the token, evaluates the grant, decides whether a human is needed, decrypts the right secret, performs
        the call, redacts the response, and appends an audit event.
      </p>
      <pre>{`agent ── JWT ──▶ POST /api/v1/proxy/slack
                    │
                    ├─ 1. verify EdDSA token + revocation list
                    ├─ 2. check agent status, grant, expiry, conditions
                    ├─ 3. approval? → 202 with approval_id
                    ├─ 4. decrypt credential (AES-256-GCM, envelope)
                    ├─ 5. call Slack with the injected token
                    └─ 6. audit: hash-chained, seq per environment`}</pre>
      <p>
        The response body is the provider&apos;s own payload. If a call needs approval, the response is{" "}
        <code>202 Accepted</code> with the approval id and a signed URL — the agent polls the same idempotency key until
        a decision lands.
      </p>

      <h2 id="surfaces">Surfaces</h2>
      <table>
        <thead>
          <tr>
            <th>Surface</th>
            <th>Use it for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><Link href="/docs/api">REST API</Link></td>
            <td>Everything the dashboard does: agents, credentials, grants, approvals, audit, webhooks.</td>
          </tr>
          <tr>
            <td><Link href="/docs/sdk">TypeScript SDK</Link></td>
            <td>Typed clients for your backend and agent runtime, with automatic token refresh.</td>
          </tr>
          <tr>
            <td><Link href="/docs/cli">CLI</Link></td>
            <td>Local development, promotion between environments, seeded demo data.</td>
          </tr>
          <tr>
            <td><Link href="/docs/mcp">MCP server</Link></td>
            <td>Expose Keel-governed tools to Claude, Cursor and other MCP hosts.</td>
          </tr>
          <tr>
            <td><Link href="/docs/connectors">Connectors</Link></td>
            <td>The exact provider actions, scopes and redaction rules Keel enforces.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="paths">Start here</h2>
      <div className="not-prose my-8 grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-2">
        {paths.map((path) => (
          <Link key={path.name} href={path.href} className="group bg-background p-5 hover:bg-foreground/[0.03]">
            <p className="text-[14px] font-medium">{path.name}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/55">{path.detail}</p>
          </Link>
        ))}
      </div>
      <p>
        In a hurry? The <Link href="/docs/quickstart">quickstart</Link> creates a working agent against the demo
        workspace, grants it one Slack action, and shows the audit event it produces.
      </p>
    </DocsShell>
  );
}
