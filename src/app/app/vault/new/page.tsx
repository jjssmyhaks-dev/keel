import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/session";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { providerSupportsConnect } from "@/lib/oauth-providers";
import { resolveOAuthClient } from "@/lib/oauth-connect";
import { ConnectorLogo } from "@/components/connector-logo";
import { createCredentialAction } from "@/app/app/actions";
import { PageHeader, Notice } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New connection" };

const ERROR_COPY: Record<string, string> = {
  connector: "Pick a service to connect.",
  secret: "Paste a credential before saving.",
  permission: "Your role cannot add connections in this environment.",
  production: "Only owners and admins can add production connections.",
  plan: "Production mode requires a paid plan. Upgrade the workspace in Billing.",
  limit: "This plan's connection limit is reached. Upgrade the workspace in Billing to add more.",
};

export default async function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ connector?: string; error?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const connectorMap = await loadConnectorMap(ctx.environment.id);
  const allConnectors = [...connectorMap.values()].filter((item) => !item.sandbox);
  const def = query.connector ? connectorMap.get(query.connector) : undefined;
  const supportsOAuthConnect = def ? def.source !== "custom" && providerSupportsConnect(def.slug) : false;
  const oauthClient = def && supportsOAuthConnect ? await resolveOAuthClient(def.slug, ctx.environment.id) : null;

  if (!def) {
    return (
      <div>
        <PageHeader
          eyebrow="Vault · add connection"
          title="Pick a service."
          description="Each connection is sealed individually. Agents never receive the secret — the proxy injects it for allowed calls only."
          actions={
            <div className="flex items-center gap-2">
              <Link href="/app/vault/import" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
                Import .env
              </Link>
              <Link href="/app/vault" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
                Back to vault
              </Link>
            </div>
          }
        />

        {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That connection could not be created."}</Notice> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {allConnectors.map((item) => (
            <Link
              key={item.slug}
              href={`/app/vault/new?connector=${item.slug}`}
              className="group border border-black/10 bg-white p-4 transition-colors hover:border-black/40 dark:border-border dark:bg-card"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-9 items-center justify-center text-white"
                  style={{ background: item.color }}
                >
                  <ConnectorLogo slug={item.slug} mark={item.mark} mono className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{item.name}</p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                    {item.category}
                    {item.source === "custom" ? " · custom" : ""}
                  </p>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 group-hover:text-black dark:text-muted-foreground dark:group-hover:text-foreground">
                  {item.status === "beta" ? "beta" : "→"}
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">{item.description}</p>
              <div className="mt-3 flex flex-wrap gap-1 border-t border-black/10 pt-2.5 dark:border-border">
                {item.authMethods.map((method) => (
                  <span key={`${method.type}-${method.label}`} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                    {method.label}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[9px] text-black/60 dark:text-muted-foreground">v{item.version}</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-6 border border-dashed border-black/15 p-5 text-center dark:border-border">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground">
            Need a service we do not ship?
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
            Scale and Enterprise workspaces can import any OpenAPI 3 document as a connector — hosts, injection rules, actions and
            version history included.
          </p>
          <Link
            href="/app/connectors"
            className="mt-3 inline-block border border-black px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] hover:bg-black hover:text-white dark:border-border dark:hover:bg-white dark:hover:text-black"
          >
            Import OpenAPI
          </Link>
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
          <div className="flex items-center gap-2">
            <Link href="/app/vault/import" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Import .env
            </Link>
            <Link href="/app/vault/new" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Choose another
            </Link>
          </div>
        }
      />

      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That connection could not be created."}</Notice> : null}

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <form action={createCredentialAction} className="border border-black/10 bg-white p-5 dark:border-border dark:bg-card">
          <input type="hidden" name="connector" value={def.slug} />
          <div className="space-y-5">
            <div>
              <label htmlFor="name" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground">
                Connection name
              </label>
              <input
                id="name"
                name="name"
                maxLength={80}
                defaultValue={`${def.name} ${ctx.environment.type === "production" ? "production" : "workspace"}`}
                className="mt-1.5 w-full border border-black/45 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
              <p className="mt-1 text-[10px] text-black/60 dark:text-muted-foreground">
                Shown in grants and the audit log. Use the workspace or mailbox name.
              </p>
            </div>

            <div>
              <label htmlFor="type" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground">
                Authentication
              </label>
              <select
                id="type"
                name="type"
                defaultValue={def.defaultAuth}
                className="mt-1.5 w-full border border-black/45 bg-[#faf9f6] px-3 py-2 text-[13px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              >
                {def.authMethods.map((method) => (
                  <option key={`${method.type}-${method.label}`} value={method.type}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            {def.credentialFields?.length ? (
              <div className="space-y-4">
                <div className="border border-black/10 bg-[#faf9f6] px-3 py-2.5 dark:border-border dark:bg-background">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Required fields
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                    {def.requireAnyFields?.length
                      ? `Provide ${def.requireAnyFields
                          .map((key) => def.credentialFields?.find((field) => field.key === key)?.label ?? key)
                          .join(" or ")}. Everything else is optional.`
                      : "Fields marked * are required. Secrets are encrypted individually and never returned."}
                  </p>
                </div>
                {def.credentialFields.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`field_${field.key}`}
                      className="flex items-baseline gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground"
                    >
                      <span>{field.label}{field.required ? " *" : ""}</span>
                      {field.secret ? (
                        <span className="border border-black/45 px-1 py-0.5 text-[8px] tracking-[0.14em] text-black/60 dark:border-white/40 dark:text-muted-foreground">
                          secret
                        </span>
                      ) : null}
                    </label>
                    {field.multiline ? (
                      <textarea
                        id={`field_${field.key}`}
                        name={`field_${field.key}`}
                        required={field.required}
                        rows={4}
                        placeholder={field.placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className="mt-1.5 w-full resize-none border border-black/45 bg-[#faf9f6] px-3 py-2 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                      />
                    ) : (
                      <input
                        id={`field_${field.key}`}
                        name={`field_${field.key}`}
                        type={field.secret ? "password" : "text"}
                        required={field.required}
                        placeholder={field.placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className="mt-1.5 w-full border border-black/45 bg-[#faf9f6] px-3 py-2 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                      />
                    )}
                    {field.help ? (
                      <p className="mt-1 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">{field.help}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <label htmlFor="secret" className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground">
                  Secret
                </label>
                <textarea
                  id="secret"
                  name="secret"
                  required
                  rows={3}
                  placeholder={def.defaultAuth === "api_key" ? "sk_live_…" : "xoxb-… or access token"}
                  spellCheck={false}
                  className="mt-1.5 w-full resize-none border border-black/45 bg-[#faf9f6] px-3 py-2 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Encrypted with a per-connection data key before it is written. Only the last four characters are kept in
                  clear for identification.
                </p>
              </div>
            )}

            <div className="border border-black/10 bg-[#faf9f6] p-3 dark:border-border dark:bg-background">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Requested scopes
              </p>
              <ul className="mt-2 space-y-1">
                {def.scopes.map((scope) => (
                  <li key={scope.value} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-black/40" />
                    <span>
                      <span className="font-mono text-[10px]">{scope.value}</span>
                      <span className="text-black/60 dark:text-muted-foreground"> — {scope.label}</span>
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
          {supportsOAuthConnect ? (
            <div className={`border p-4 ${oauthClient ? "border-[#2f7d5c]/40 bg-[#2f7d5c]/[0.05]" : "border-black/15 bg-white dark:border-border dark:bg-card"}`}>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                One-click OAuth
              </p>
              {oauthClient ? (
                <>
                  <p className="mt-1.5 text-[12px] font-medium">Authorize {def.name} instead of pasting a token.</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                    Tokens are exchanged server-side, sealed in the vault and refreshed before they expire.
                  </p>
                  <Link
                    href={`/api/connect/${def.slug}/start`}
                    className="mt-3 block border border-[#2f7d5c] bg-[#2f7d5c] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#245f47]"
                  >
                    Connect with {def.name}
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12px] font-medium">OAuth connect is not configured.</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                    Add the {def.name} client ID and secret under OAuth apps, or set CONNECT_* environment variables.
                    Until then, paste a token manually.
                  </p>
                  <Link
                    href={`/app/connect?connector=${def.slug}`}
                    className="mt-3 block border border-black/20 px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border"
                  >
                    Configure OAuth app
                  </Link>
                </>
              )}
            </div>
          ) : null}

          <div className="border border-black/10 bg-black p-5 text-white dark:border-border">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center" style={{ background: def.color }}>
                <ConnectorLogo slug={def.slug} mark={def.mark} mono className="size-4" />
              </span>
              <div>
                <p className="text-[12px] font-medium">{def.name}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/80">v{def.version}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-[11px] leading-relaxed text-white/80">
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/80">Hosts the proxy reaches</dt>
                <dd className="mt-0.5 font-mono text-[10px]">{def.hosts.join(" · ")}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/80">Injected as</dt>
                <dd className="mt-0.5 font-mono text-[10px]">
                  {def.injection.name}: {def.injection.prefix ?? ""}&lt;secret&gt;
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/80">Redacted in logs</dt>
                <dd className="mt-0.5 font-mono text-[10px]">{def.redactedFields.join(", ")}</dd>
              </div>
            </dl>
          </div>

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Available actions</p>
            <ul className="mt-2 space-y-1.5">
              {def.actions.map((action) => (
                <li key={action.name} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`border px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${
                      action.risk === "read"
                        ? "text-[#276a4e] dark:text-[#7fd1ab]"
                        : action.risk === "destructive"
                          ? "text-[#b3402f] dark:text-[#f09486]"
                          : action.risk === "financial"
                            ? "text-[#7a3db8] dark:text-[#c9a6f5]"
                            : action.risk === "admin"
                              ? "text-[#25567a] dark:text-[#93c5e8]"
                              : "text-[#8a5600] dark:text-[#e8b26a]"
                    }`}
                  >
                    {action.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{action.risk}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-black/10 pt-2.5 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
              Adding a connection does not grant anything. Agents stay at zero access until you approve a grant.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
