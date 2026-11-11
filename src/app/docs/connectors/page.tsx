import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DocsShell } from "@/components/docs/docs-shell";
import { ConnectorLogo } from "@/components/connector-logo";
import { CONNECTORS } from "@/lib/connectors";

export const metadata: Metadata = {
  title: "Connectors",
  description: "The integrations Authab governs, with exact actions, risk levels and scopes.",
};

export default function ConnectorsPage() {
  const categories = [...new Set(CONNECTORS.map((connector) => connector.category))];

  return (
    <DocsShell
      eyebrow="Integrations"
      title="Connectors"
      intro="A connector defines the provider endpoints Authab can call, the actions an agent may request, each action's risk level, and which fields are redacted. Grants reference these actions by name — there is no arbitrary URL proxying."
      updated="11 November 2026"
    >
      <p>
        Each connector pins its providers&apos; hosts and an injection rule for credentials. The proxy builds the URL from
        the connector definition, not from agent input, so an agent cannot redirect a call to an arbitrary host. The
        curated catalogue below covers common integrations; anything else can be imported from an OpenAPI 3 document as
        a versioned custom connector.
      </p>

      {categories.map((category) => (
        <section key={category}>
          <h2>{category}</h2>
          <div className="not-prose my-6 grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-2">
            {CONNECTORS.filter((connector) => connector.category === category).map((connector) => (
              <Link
                key={connector.slug}
                href={`/docs/connectors/${connector.slug}`}
                className="group flex items-start gap-4 bg-background p-5 hover:bg-foreground/[0.03]"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center text-white"
                  style={{ backgroundColor: connector.color }}
                >
                  <ConnectorLogo slug={connector.slug} mark={connector.mark} mono className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{connector.name}</span>
                    <span className="mono-label text-foreground/30">{connector.version}</span>
                    {connector.status === "beta" ? (
                      <span className="border border-[#eca8d6] px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em]">
                        Beta
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-foreground/55">{connector.description}</span>
                  <span className="mt-2 block font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/35">
                    {connector.actions.length} actions · {connector.authMethods[0]?.label ?? "API key"}
                  </span>
                </span>
                <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-foreground/25 group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <h2>Risk levels</h2>
      <table>
        <thead>
          <tr><th>Level</th><th>Meaning</th><th>Default in development</th><th>Default in production</th></tr>
        </thead>
        <tbody>
          <tr><td><code>read</code></td><td>Lists, reads, searches.</td><td>Allow</td><td>Allow</td></tr>
          <tr><td><code>write</code></td><td>Creates or edits data; usually reversible.</td><td>Allow</td><td>Require approval</td></tr>
          <tr><td><code>admin</code></td><td>Changes access, configuration or infrastructure.</td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>destructive</code></td><td>Deletes or overwrites; hard to reverse.</td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>financial</code></td><td>Moves money or creates billable commitments.</td><td>Require approval</td><td>Require approval</td></tr>
        </tbody>
      </table>
      <p>
        Risk can be overridden per grant and per approval policy, but the connector&apos;s declared level is the floor for
        defaults. A missing or unknown action is denied outright.
      </p>

      <h2>Custom connectors</h2>
      <p>
        Owners and admins on the Scale and Enterprise plans can paste an OpenAPI 3.0 or 3.1 document — JSON or YAML, up
        to 1 MB — in the dashboard or post it to the API. Authab resolves local <code>$ref</code> pointers, compiles
        each operation into an action, infers a risk level from the method and verb, and derives the credential
        injection from the spec&apos;s security scheme.
      </p>
      <pre>{`POST /api/v1/connectors
{
  "spec": "{ \\"openapi\\": \\"3.1.0\\", ... }",
  "slug": "acme-billing",
  "name": "Acme Billing",
  "category": "Finance",
  "baseUrl": "https://api.acme.example/v2",   // optional override
  "authScheme": "ApiKeyAuth"                  // optional, defaults to the first supported scheme
}

201 {
  "object": "custom_connector",
  "version": 1,
  "warnings": [],
  "connector": { "slug": "acme-billing", "actions": [ ... ], ... }
}`}</pre>
      <p>
        Supported auth is <code>apiKey</code> in a header or query parameter, HTTP <code>bearer</code> and HTTP{" "}
        <code>basic</code>. OAuth2 and OpenID Connect schemes are rejected because they need a provider-specific token
        flow; connect those providers through OAuth apps instead. Base URLs must use HTTPS and must not resolve to
        private or link-local hosts, and server variables must be supplied rather than left as placeholders. Actions
        with deprecated flags, required header or cookie parameters, XML bodies, or a security scheme the proxy cannot
        inject are skipped with a warning; a spec that compiles to zero actions is rejected.
      </p>
      <p>
        Specs are limited to 100 actions per import — split larger documents. Every import of a changed spec creates a
        new version, and an identical re-import is a no-op. List versions with{" "}
        <code>GET /api/v1/connectors/:slug</code>, restore one with{" "}
        <code>POST /api/v1/connectors/:slug/rollback</code> and <code>{"{ version }"}</code>, and retire a connector
        with <code>DELETE /api/v1/connectors/:slug</code>. Archiving keeps existing grants and audit history but blocks
        new calls; rolling back also re-activates an archived connector. Grants, approvals and the policy lab resolve
        custom actions the same way they resolve built-in ones.
      </p>
      <p>
        The proxy still builds every URL from the stored connector definition. Imported operations cannot widen the
        host list; same-origin redirects are followed, and an off-origin redirect is refused rather than forwarded with
        credentials.
      </p>
    </DocsShell>
  );
}
