import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsShell } from "@/components/docs/docs-shell";
import { CONNECTORS, connector } from "@/lib/connectors";

export function generateStaticParams() {
  return CONNECTORS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const def = connector(slug);
  if (!def) return { title: "Connector" };
  return {
    title: `${def.name} connector — Keel docs`,
    description: def.description,
  };
}

const riskTone: Record<string, string> = {
  read: "#2f7d5c",
  write: "#8a5a00",
  destructive: "#8c3225",
  financial: "#5b2f8c",
};

export default async function ConnectorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = connector(slug);
  if (!def) notFound();

  const sample = def.actions[0];

  return (
    <DocsShell
      eyebrow={`Connectors · ${def.category}`}
      title={`${def.name} connector`}
      intro={def.description}
      updated={`Version ${def.version} · ${def.status}`}
    >
      <div className="not-prose my-8 grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-3">
        <div className="bg-background p-4">
          <p className="mono-label text-foreground/35">Hosts</p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed">{def.hosts.join(", ")}</p>
        </div>
        <div className="bg-background p-4">
          <p className="mono-label text-foreground/35">Credential injection</p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed">
            {def.injection.name}: {def.injection.prefix ?? ""}…
          </p>
        </div>
        <div className="bg-background p-4">
          <p className="mono-label text-foreground/35">Auth</p>
          <p className="mt-2 text-[12px] leading-relaxed">{def.authMethods.map((method) => method.label).join(" · ")}</p>
        </div>
      </div>

      <h2>Actions</h2>
      <p>
        Grants name these actions exactly. The proxy refuses anything outside this list, so the catalogue is also the
        blast-radius boundary.
      </p>
      <table>
        <thead>
          <tr><th>Action</th><th>Risk</th><th>Method</th><th>Description</th></tr>
        </thead>
        <tbody>
          {def.actions.map((action) => (
            <tr key={action.name}>
              <td><code>{action.name}</code></td>
              <td>
                <span className="border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: riskTone[action.risk], borderColor: `${riskTone[action.risk]}40` }}>
                  {action.risk}
                </span>
              </td>
              <td><code>{action.method}</code></td>
              <td>{action.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Scopes</h2>
      <p>
        OAuth scopes to request when you connect a real provider account. Keel stores the token, not the scopes; the
        grant is the effective permission. Request the minimum the agent needs.
      </p>
      <table>
        <thead>
          <tr><th>Scope</th><th>Why</th></tr>
        </thead>
        <tbody>
          {def.scopes.map((scope) => (
            <tr key={scope.value}>
              <td><code>{scope.value}</code>{scope.optional ? " (optional)" : ""}</td>
              <td>{scope.label}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Redaction</h2>
      <p>
        Fields marked sensitive are removed from approval payloads and from audit summaries:{" "}
        {def.redactedFields.map((field) => <code key={field} className="mr-1">{field}</code>)}.
      </p>
      <p>
        Credential material is injected only at execution time. For {def.name}, agents pass the resource (
        {def.resourceLabel.toLowerCase()}) and input fields, never the token.
      </p>

      {sample ? (
        <>
          <h2>Example request</h2>
          <pre>{`POST /api/v1/proxy/${def.slug}
Authorization: Bearer <agent-jwt>
Idempotency-Key: ${def.slug}-${sample.name.split(".")[1]?.replace(/_/g, "-") ?? "call"}-001

{
  "credentialId": "cred_${def.slug}",
  "action": "${sample.name}",
  "resource": "${def.resourcePlaceholder}",
  "input": ${JSON.stringify(sample.fields ? Object.fromEntries(sample.fields.map((field) => [field.key, field.placeholder ?? ""])) : {}, null, 2).replace(/\n/g, "\n  ")}
}`}</pre>
        </>
      ) : null}

      <p>
        Return to the <Link href="/docs/connectors">connector catalogue</Link>, read about{" "}
        <Link href="/docs/concepts/policy">policy</Link>, or link a connection in{" "}
        <Link href="/app/vault/new">the vault</Link>.
      </p>
    </DocsShell>
  );
}
