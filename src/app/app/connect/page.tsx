import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { CONNECT_PROVIDERS, envClientFor, providerEnvPrefix } from "@/lib/oauth-providers";
import { connector } from "@/lib/connectors";
import { connectRedirectUri, resolveOAuthClient } from "@/lib/oauth-connect";
import { ConnectorLogo } from "@/components/connector-logo";
import { saveOAuthAppAction, removeOAuthAppAction } from "@/app/app/oauth-actions";
import { PageHeader, Panel, Notice } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "OAuth apps" };

export default async function OAuthAppsPage({
  searchParams,
}: {
  searchParams: Promise<{ connector?: string; error?: string; saved?: string; removed?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const canManage = ctx.capabilities.manageCredentials && (!ctx.isProduction || ctx.capabilities.writeProduction);

  const apps = await db.oAuthApp.findMany({ where: { environmentId: ctx.environment.id } });
  const appBySlug = new Map(apps.map((app) => [app.connectorSlug, app]));
  const resolved = new Map(
    await Promise.all(
      Object.keys(CONNECT_PROVIDERS).map(async (slug) => {
        const client = await resolveOAuthClient(slug, ctx.environment.id);
        return [slug, client] as const;
      }),
    ),
  );

  return (
    <div>
      <PageHeader
        eyebrow={`Vault · ${ctx.environment.type} environment`}
        title="One-click OAuth apps."
        description="Register an OAuth app once and the vault offers Connect buttons for that provider. Tokens are exchanged server-side, sealed with the connection key and refreshed before they expire. Client secrets never reach the browser."
        actions={
          <Link href="/app/vault" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
            Vault
          </Link>
        }
      />

      {query.error ? (
        <Notice kind="error">
          {query.error === "permission"
            ? "Your role cannot manage OAuth apps in this environment."
            : query.error === "production"
              ? "Only owners and admins can configure production OAuth apps."
              : query.error === "client"
                ? "Enter the OAuth client ID issued by the provider."
                : query.error === "secret"
                  ? "Enter the OAuth client secret."
                  : query.error === "missing"
                    ? "That OAuth app no longer exists."
                    : "That OAuth app could not be saved."}
        </Notice>
      ) : null}
      {query.saved ? <Notice kind="ok">OAuth app saved. The provider is now connectable from the vault.</Notice> : null}
      {query.removed ? <Notice kind="ok">OAuth app removed. Existing connections keep their tokens until revoked.</Notice> : null}

      <div className="mb-6 border border-black/10 bg-[#faf9f6] p-4 text-[11px] leading-relaxed text-black/65 dark:border-border dark:bg-card dark:text-muted-foreground">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
          Redirect URI to register at the provider
        </p>
        <p className="mt-1.5 font-mono text-[11px] break-all">
          {connectRedirectUri("<connector>")}
        </p>
        <p className="mt-2">
          OAuth apps are scoped to the {ctx.environment.type} environment. A development app and a production app usually
          have different client credentials. Server-wide credentials can also come from environment variables
          (CONNECT_&lt;PROVIDER&gt;_CLIENT_ID / _CLIENT_SECRET) without storing anything in the database.
        </p>
      </div>

      <div className="space-y-3">
        {Object.values(CONNECT_PROVIDERS).map((provider) => {
          const def = connector(provider.key);
          const app = appBySlug.get(provider.key);
          const client = resolved.get(provider.key);
          const env = envClientFor(provider.key);
          const open = query.connector === provider.key && canManage;
          const envPrefix = providerEnvPrefix(provider.key);
          return (
            <details
              key={provider.key}
              open={open}
              className="group border border-black/10 bg-white dark:border-border dark:bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span
                  className="flex size-9 items-center justify-center text-white"
                  style={{ background: def?.color ?? "#333333" }}
                >
                  <ConnectorLogo slug={provider.key} mark={def?.mark ?? provider.label.slice(0, 2)} mono className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{def?.name ?? provider.label}</p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                    {app ? `database app · ${app.clientId}` : env ? "server env credentials" : "not configured"}
                  </p>
                </div>
                <span
                  className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${
                    client
                      ? "border-[#2f7d5c]/30 bg-[#2f7d5c]/10 text-[#276a4e] dark:text-[#7fd1ab]"
                      : "border-black/15 text-black/60 dark:border-border dark:text-muted-foreground"
                  }`}
                >
                  {client ? "connect ready" : "add client"}
                </span>
              </summary>

              <div className="grid gap-4 border-t border-black/10 p-4 dark:border-border md:grid-cols-[1.4fr_1fr]">
                <form action={saveOAuthAppAction} className="space-y-3">
                  <input type="hidden" name="connector" value={provider.key} />
                  <div>
                    <label htmlFor={`clientId-${provider.key}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Client ID
                    </label>
                    <input
                      id={`clientId-${provider.key}`}
                      name="clientId"
                      required
                      defaultValue={app?.clientId ?? ""}
                      placeholder={`${provider.key}-client-id`}
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div>
                    <label htmlFor={`clientSecret-${provider.key}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Client secret {app ? "· leave blank to keep" : ""}
                    </label>
                    <input
                      id={`clientSecret-${provider.key}`}
                      name="clientSecret"
                      type="password"
                      autoComplete="off"
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div>
                    <label htmlFor={`scopes-${provider.key}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Scopes
                    </label>
                    <textarea
                      id={`scopes-${provider.key}`}
                      name="scopes"
                      rows={2}
                      defaultValue={(app ? (JSON.parse(app.scopesJson || "[]") as string[]) : provider.scopes).join(" ")}
                      className="mt-1 w-full resize-none border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`sep-${provider.key}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                        Scope separator
                      </label>
                      <select
                        id={`sep-${provider.key}`}
                        name="scopeSeparator"
                        defaultValue={app?.scopeSeparator || provider.scopeSeparator}
                        className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                      >
                        <option value=" ">space</option>
                        <option value=",">comma</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`auth-${provider.key}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                        Token auth
                      </label>
                      <select
                        id={`auth-${provider.key}`}
                        name="tokenAuth"
                        defaultValue={app?.tokenAuth || provider.tokenAuth}
                        className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                      >
                        <option value="body">client_secret_post</option>
                        <option value="basic">client_secret_basic</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11px]">
                    <input type="checkbox" name="pkce" defaultChecked={app ? app.pkce : provider.pkce} />
                    Use PKCE (S256)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={!canManage}
                      className="border border-black bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
                    >
                      Save OAuth app
                    </button>
                    <Link href={`/app/vault/new?connector=${provider.key}`} className="border border-black/45 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40">
                      Manual token
                    </Link>
                  </div>
                </form>

                <div className="space-y-3">
                  <div className="border border-black/10 bg-[#faf9f6] p-3 dark:border-border dark:bg-background">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Redirect URI
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px]">{connectRedirectUri(provider.key)}</p>
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Server env fallback
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px]">
                      CONNECT_{envPrefix}_CLIENT_ID
                      <br />
                      CONNECT_{envPrefix}_CLIENT_SECRET
                    </p>
                    {env ? (
                      <p className="mt-2 text-[10px] text-[#276a4e] dark:text-[#7fd1ab]">Environment credentials detected for {env.clientId}.</p>
                    ) : null}
                  </div>
                  <div className="border border-black/10 p-3 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
                    Default scopes: {provider.scopes.join(", ") || "provider-managed"}.
                    {provider.extraAuthParams ? (
                      <>
                        <br />
                        Extra authorize params:{" "}
                        {Object.entries(provider.extraAuthParams)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(", ")}
                        .
                      </>
                    ) : null}
                  </div>
                  {app ? (
                    <form action={removeOAuthAppAction}>
                      <input type="hidden" name="connector" value={provider.key} />
                      <button
                        type="submit"
                        disabled={!canManage}
                        className="w-full border border-[#b3402f]/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#b3402f] hover:border-[#b3402f] disabled:opacity-40"
                      >
                        Remove OAuth app
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <Panel title="How the flow works" hint="Authorization code + PKCE" bodyClassName="p-4" className="mt-6">
        <ol className="space-y-2 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
          <li><span className="font-mono text-[10px]">1.</span> The vault opens the provider&apos;s authorize URL with a signed state and an S256 PKCE challenge.</li>
          <li><span className="font-mono text-[10px]">2.</span> The callback verifies the signed state, the session user and the client ID before exchanging the code.</li>
          <li><span className="font-mono text-[10px]">3.</span> Tokens are sealed with a per-connection data key. Only the last four characters of the access token stay in clear text.</li>
          <li><span className="font-mono text-[10px]">4.</span> The proxy refreshes tokens five minutes before expiry and rotates refresh tokens. Permanent failures mark the connection broken and notify owners.</li>
          <li><span className="font-mono text-[10px]">5.</span> A scheduled sweep probes every connection with a read-only provider call and records the result in the health timeline.</li>
        </ol>
      </Panel>
    </div>
  );
}
