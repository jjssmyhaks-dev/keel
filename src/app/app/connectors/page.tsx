import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import {
  customConnectorAccess,
  serializeCustomConnector,
} from "@/lib/custom-connectors";
import {
  archiveCustomConnectorAction,
  importCustomConnectorAction,
  rollbackCustomConnectorAction,
} from "@/app/app/actions";
import { ConfirmButton } from "@/components/app/confirm-button";
import {
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  RiskBadge,
  formatDate,
  relativeTime,
} from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Connectors" };

const ERROR_COPY: Record<string, string> = {
  permission: "Only owners and admins can manage custom connectors.",
  spec: "Paste an OpenAPI 3 document before importing.",
  missing: "That connector no longer exists.",
};

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const access = customConnectorAccess(ctx.org.plan, ctx.org.planStatus);

  const [rows, credentialCounts] = await Promise.all([
    db.customConnector.findMany({
      where: { environmentId: ctx.environment.id },
      include: { versions: { orderBy: { version: "desc" }, select: { version: true, specVersion: true, createdAt: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    db.credential.groupBy({
      by: ["connectorSlug"],
      where: { environmentId: ctx.environment.id, revokedAt: null },
      _count: { _all: true },
    }),
  ]);

  const countFor = (slug: string) => credentialCounts.find((row) => row.connectorSlug === slug)?._count._all ?? 0;
  const canManage = ctx.capabilities.manageSecurity;

  return (
    <div>
      <PageHeader
        eyebrow={`Connectors · ${ctx.environment.type}`}
        title="Bring the long tail."
        description="Import any OpenAPI 3 document as a first-class connector. Authab compiles paths into actions, infers risk from the method and verb, keeps the host allowlist tight and versions every import so you can roll back."
        actions={
          <>
            <Link
              href="/app/vault/new"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Vault
            </Link>
            <Link
              href="/docs/connectors"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Connector docs
            </Link>
          </>
        }
      />

      {query.error && ERROR_COPY[query.error] ? <Notice kind="error">{ERROR_COPY[query.error]}</Notice> : null}
      {query.error === "import" ? <Notice kind="error">{query.detail ?? "That spec could not be imported."}</Notice> : null}
      {query.error === "plan" ? (
        <Notice kind="error">
          {query.detail ?? "Custom connectors are available on Scale and Enterprise."}{" "}
          <Link href="/app/billing" className="underline underline-offset-2">
            Upgrade in Billing
          </Link>
        </Notice>
      ) : null}
      {query.imported ? (
        <Notice kind="ok">
          Imported {query.imported} as version {query.version}.
          {query.warnings ? ` ${query.warnings} operation${query.warnings === "1" ? "" : "s"} were skipped — review the actions below.` : ""}
        </Notice>
      ) : null}
      {query.restored ? <Notice kind="ok">Restored {query.restored} from version {query.version}.</Notice> : null}
      {query.archived ? <Notice kind="ok">Archived {query.archived}. Its credentials can no longer resolve.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          {rows.length ? (
            rows.map((row) => {
              const def = serializeCustomConnector(row);
              const archived = row.status === "archived";
              return (
                <section
                  key={row.id}
                  className={`border bg-white dark:bg-card ${archived ? "border-black/10 opacity-70 dark:border-border" : "border-black/10 dark:border-border"}`}
                >
                  <header className="flex flex-wrap items-center gap-2.5 border-b border-black/10 px-4 py-3 dark:border-border">
                    <span className="flex size-8 items-center justify-center font-mono text-[11px] font-medium text-white" style={{ background: row.color }}>
                      {row.mark}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{row.name}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                        {row.slug} · v{row.version} · {row.specVersion ?? "OpenAPI"} · {def.actions.length} actions
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                        {archived ? "archived" : countFor(row.slug)} credential{countFor(row.slug) === 1 ? "" : "s"}
                      </span>
                      <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                        {def.auth.type}
                      </span>
                    </div>
                  </header>

                  <div className="space-y-3 px-4 py-3">
                    <p className="text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">{row.description}</p>
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                      hosts {def.hosts.join(" · ")}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {def.actions.slice(0, 10).map((action) => (
                        <span
                          key={action.name}
                          className="flex items-center gap-1 border border-black/10 px-1.5 py-0.5 font-mono text-[9px] text-black/65 dark:border-border dark:text-muted-foreground"
                        >
                          {action.name}
                          <RiskBadge risk={action.risk} />
                        </span>
                      ))}
                      {def.actions.length > 10 ? (
                        <span className="px-1.5 py-0.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          +{def.actions.length - 10} more
                        </span>
                      ) : null}
                    </div>

                    {!archived && canManage ? (
                      <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-3 dark:border-border">
                        <form action={archiveCustomConnectorAction}>
                          <input type="hidden" name="slug" value={row.slug} />
                          <ConfirmButton
                            message={`Archive ${row.slug}? Credentials using it stop resolving and calls fail closed.`}
                            className="border border-[#b3402f]/35 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8c3225] dark:text-[#f0a396] hover:bg-[#b3402f] hover:text-white"
                          >
                            Archive
                          </ConfirmButton>
                        </form>
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                          updated {relativeTime(row.updatedAt)}
                        </span>
                      </div>
                    ) : null}

                    <details className="border-t border-black/10 pt-2 dark:border-border">
                      <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                        Version history ({row.versions.length})
                      </summary>
                      <dl className="mt-2 divide-y divide-black/10 dark:divide-border">
                        {row.versions.map((version) => (
                          <div key={version.version} className="flex flex-wrap items-center gap-2 py-1.5 text-[11px]">
                            <span className="font-mono text-[10px]">v{version.version}</span>
                            <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                              {version.specVersion ?? "spec"} · {formatDate(version.createdAt)}
                            </span>
                            {canManage && version.version !== row.version && !archived ? (
                              <form action={rollbackCustomConnectorAction} className="ml-auto">
                                <input type="hidden" name="slug" value={row.slug} />
                                <input type="hidden" name="version" value={version.version} />
                                <ConfirmButton
                                  message={`Restore ${row.slug} to v${version.version}? This creates v${row.version + 1} with the old definition.`}
                                  className="border border-black/45 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] hover:border-black dark:border-white/40"
                                >
                                  Restore
                                </ConfirmButton>
                              </form>
                            ) : null}
                          </div>
                        ))}
                      </dl>
                    </details>
                  </div>
                </section>
              );
            })
          ) : (
            <Panel bodyClassName="p-0">
              <EmptyState
                title="No custom connectors yet."
                description="Paste an OpenAPI 3 document on the right. Authab compiles it into actions that grants, approvals and the policy lab understand immediately."
                action={
                  <Link
                    href="/app/vault/new"
                    className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white"
                  >
                    Browse built-in connectors
                  </Link>
                }
              />
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Import OpenAPI" hint="JSON or YAML · 3.0 / 3.1" bodyClassName="p-4">
            {canManage && access.allowed ? (
              <form action={importCustomConnectorAction} className="space-y-3">
                <div>
                  <label htmlFor="spec" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Document
                  </label>
                  <textarea
                    id="spec"
                    name="spec"
                    required
                    rows={12}
                    spellCheck={false}
                    placeholder={"openapi: 3.0.3\ninfo:\n  title: Ledger API\n  version: 1.0.0\nservers:\n  - url: https://api.example.com/v1\nsecurity:\n  - bearerAuth: []\npaths:\n  /accounts/{id}:\n    get:\n      operationId: getAccount\n      …"}
                    className="mt-1 w-full resize-y border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-black dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="slug" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Slug <span className="normal-case tracking-normal text-black/60 dark:text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="slug"
                      name="slug"
                      placeholder="ledger"
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div>
                    <label htmlFor="category" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Category <span className="normal-case tracking-normal text-black/60 dark:text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="category"
                      name="category"
                      placeholder="Custom"
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div>
                    <label htmlFor="baseUrl" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Base URL override <span className="normal-case tracking-normal text-black/60 dark:text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="baseUrl"
                      name="baseUrl"
                      placeholder="https://api.example.com/v1"
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                  <div>
                    <label htmlFor="authScheme" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Auth scheme <span className="normal-case tracking-normal text-black/60 dark:text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="authScheme"
                      name="authScheme"
                      placeholder="bearerAuth"
                      className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                    />
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Local <span className="font-mono">$ref</span> pointers resolve automatically. OAuth2-only specs are rejected —
                  bearer, API key and basic schemes are proxied. Re-importing a changed spec creates a new version; an identical
                  spec is a no-op.
                </p>
                <button
                  type="submit"
                  className="w-full border border-black bg-black px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
                >
                  Compile and import
                </button>
              </form>
            ) : (
              <div>
                <p className="text-[12px] leading-relaxed text-black/65 dark:text-muted-foreground">
                  {canManage
                    ? access.message
                    : "Your role can view connectors but not import them. Owners and admins manage the connector catalogue."}
                </p>
                {canManage && !access.allowed ? (
                  <Link
                    href="/app/billing"
                    className="mt-3 inline-block border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white"
                  >
                    Upgrade to Scale
                  </Link>
                ) : null}
              </div>
            )}
          </Panel>

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
              What the compiler does
            </p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
              <li>Every operation becomes an action with a stable name</li>
              <li>Risk is inferred from method and verb, or set with <span className="font-mono">x-authab-risk</span></li>
              <li>Hosts stay allowlisted to the servers in the spec</li>
              <li>Path, query and JSON body fields become typed action inputs</li>
              <li>One safe GET becomes the credential health probe</li>
              <li>Agents still need a grant before any action runs</li>
            </ul>
            <p className="mt-3 border-t border-black/10 pt-2 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
              Custom connectors are scoped to this environment. The development and production catalogues are independent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
