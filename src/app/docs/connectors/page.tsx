import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DocsShell } from "@/components/docs/docs-shell";
import { CONNECTORS } from "@/lib/connectors";

export const metadata: Metadata = {
  title: "Connectors — Keel docs",
  description: "The integrations Keel governs, with exact actions, risk levels and scopes.",
};

export default function ConnectorsPage() {
  const categories = [...new Set(CONNECTORS.map((connector) => connector.category))];

  return (
    <DocsShell
      eyebrow="Integrations"
      title="Connectors"
      intro="A connector defines the provider endpoints Keel can call, the actions an agent may request, each action's risk level, and which fields are redacted. Grants reference these actions by name — there is no arbitrary URL proxying."
      updated="31 October 2026"
    >
      <p>
        Each connector pins its providers&apos; hosts and an injection rule for credentials. The proxy builds the URL from
        the connector definition, not from agent input, so an agent cannot redirect a call to an arbitrary host. If you
        need an integration that is not on this list, use the generic HTTP connector with an explicit host allow-list or
        contact us.
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
                  className="flex size-9 shrink-0 items-center justify-center font-mono text-[10px] text-white"
                  style={{ backgroundColor: connector.color }}
                >
                  {connector.mark}
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
          <tr><td><code>destructive</code></td><td>Deletes or overwrites; hard to reverse.</td><td>Require approval</td><td>Require approval</td></tr>
          <tr><td><code>financial</code></td><td>Moves money or creates billable commitments.</td><td>Require approval</td><td>Require approval</td></tr>
        </tbody>
      </table>
      <p>
        Risk can be overridden per grant and per approval policy, but the connector&apos;s declared level is the floor for
        defaults. A missing or unknown action is denied outright.
      </p>
    </DocsShell>
  );
}
