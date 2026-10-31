import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/session";
import { CONNECTORS, connector, type AuthMethod } from "@/lib/connectors";
import { createCredentialAction } from "@/app/app/actions";
import { PageHeader, Notice } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New connection" };

const ERROR_COPY: Record<string, string> = {
  connector: "Pick a service to connect.",
  secret: "Paste a credential before saving.",
  permission: "Your role cannot add connections in this environment.",
  production: "Only owners and admins can add production connections.",
};

const AUTH_LABEL: Record<AuthMethod, string> = {
  oauth: "OAuth 2.0",
  api_key: "API key",
  bearer: "Bearer token",
  basic: "Basic auth",
};

export default async function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ connector?: string; error?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const def = query.connector ? connector(query.connector) : undefined;

  if (!def) {
    return (
      <div>
        <PageHeader
          eyebrow="Vault · add connection"
          title="Pick a service."
          description="Each connection is sealed individually. Agents never receive the secret — the proxy injects it for allowed calls only."
          actions={
            <Link href="/app/vault" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
              Back to vault
            </Link>
          }
        />

        {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That connection could not be created."}</Notice> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CONNECTORS.map((item) => (
            <Link
              key={item.slug}
              href={`/app/vault/new?connector=${item.slug}`}
              className="group border border-black/10 bg-white p-4 transition-colors hover:border-black/40 dark:border-border dark:bg-card"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-9 items-center justify-center font-mono text-[11px] font-medium text-white"
                  style={{ background: item.color }}
                >
                  {item.mark}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{item.name}</p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
                    {item.category}
                  </p>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/30 group-hover:text-black dark:text-muted-foreground dark:group-hover:text-foreground">
                  {item.status === "beta" ? "beta" : "→"}
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">{item.description}</p>
              <div className="mt-3 flex flex-wrap gap-1 border-t border-black/10 pt-2.5 dark:border-border">
                {item.authMethods.map((method) => (
                  <span key={method.type} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/45 dark:border-border dark:text-muted-foreground">
                    {AUTH_LABEL[method.type]}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[9px] text-black/30 dark:text-muted-foreground">v{item.version}</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-6 border border-dashed border-black/15 p-5 text-center dark:border-border">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/40 dark:text-muted-foreground">
            Need a service we do not ship?
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-[12px] leading-relaxed text-black/50 dark:text-muted-foreground">
            Custom HTTP connectors are available on Scale and Enterprise. Your security team can register hosts, injection
            rules and redacted fields without waiting on us.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={`Vault · ${def.category}`}
        title={`Connect ${def.name}.`}
        description={def.description}
        actions={
          <Link href="/app/vault/new" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Choose another
          </Link>
        }
      />

      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That connection could not be created."}</Notice> : null}

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <form action={createCredentialAction} className="border border-black/10 bg-white p-5 dark:border-border dark:bg-card">
          <input type="hidden" name="connector" value={def.slug} />
          <div className="space-y-5">
            <div>
              <label htmlFor="name" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                Connection name
              </label>
              <input
                id="name"
                name="name"
                maxLength={80}
                defaultValue={`${def.name} ${ctx.environment.type === "production" ? "production" : "workspace"}`}
                className="mt-1.5 w-full border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-border dark:bg-background"
              />
              <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">
                Shown in grants and the audit log. Use the workspace or mailbox name.
              </p>
            </div>

            <div>
              <label htmlFor="type" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                Authentication
              </label>
              <select
                id="type"
                name="type"
                defaultValue={def.defaultAuth}
                className="mt-1.5 w-full border border-black/15 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-border dark:bg-background"
              >
                {def.authMethods.map((method) => (
                  <option key={method.type} value={method.type}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="secret" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45 dark:text-muted-foreground">
                Secret
              </label>
              <textarea
                id="secret"
                name="secret"
                required
                rows={3}
                placeholder={def.defaultAuth === "api_key" ? "sk_live_…" : "xoxb-… or access token"}
                spellCheck={false}
                className="mt-1.5 w-full resize-none border border-black/15 bg-[#faf9f6] px-3 py-2 font-mono text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
              />
              <p className="mt-1 text-[10px] leading-relaxed text-black/40 dark:text-muted-foreground">
                Encrypted with a per-connection data key before it is written. Only the last four characters are kept in
                clear for identification.
              </p>
            </div>

            <div className="border border-black/10 bg-[#faf9f6] p-3 dark:border-border dark:bg-background">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                Requested scopes
              </p>
              <ul className="mt-2 space-y-1">
                {def.scopes.map((scope) => (
                  <li key={scope.value} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-black/40" />
                    <span>
                      <span className="font-mono text-[10px]">{scope.value}</span>
                      <span className="text-black/50 dark:text-muted-foreground"> — {scope.label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="submit"
              className="w-full border border-black bg-black px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
            >
              Seal and store
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="border border-black/10 bg-black p-5 text-white dark:border-border">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center font-mono text-[10px]" style={{ background: def.color }}>
                {def.mark}
              </span>
              <div>
                <p className="text-[12px] font-medium">{def.name}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/45">v{def.version}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-[11px] leading-relaxed text-white/65">
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">Hosts the proxy reaches</dt>
                <dd className="mt-0.5 font-mono text-[10px]">{def.hosts.join(" · ")}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">Injected as</dt>
                <dd className="mt-0.5 font-mono text-[10px]">
                  {def.injection.name}: {def.injection.prefix ?? ""}&lt;secret&gt;
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">Redacted in logs</dt>
                <dd className="mt-0.5 font-mono text-[10px]">{def.redactedFields.join(", ")}</dd>
              </div>
            </dl>
          </div>

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">Available actions</p>
            <ul className="mt-2 space-y-1.5">
              {def.actions.map((action) => (
                <li key={action.name} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="border px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em]"
                    style={{ color: action.risk === "read" ? "#2f7d5c" : action.risk === "destructive" ? "#b3402f" : action.risk === "financial" ? "#7a3db8" : "#a56b18" }}
                  >
                    {action.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  <span className="font-mono text-[9px] text-black/35 dark:text-muted-foreground">{action.risk}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-black/10 pt-2.5 text-[10px] leading-relaxed text-black/45 dark:border-border dark:text-muted-foreground">
              Adding a connection does not grant anything. Agents stay at zero access until you approve a grant.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
