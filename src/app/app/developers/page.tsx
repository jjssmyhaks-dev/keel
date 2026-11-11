import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { createWebhookAction, deleteWebhookAction, revokeApiKeyAction } from "@/app/app/actions";
import { ApiKeyCreator } from "@/components/app/api-key-creator";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader, Panel, StatusBadge, Notice, relativeTime } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const canManage = ctx.can("manage_security");

  const [apiKeys, webhooks] = await Promise.all([
    db.apiKey.findMany({ where: { environmentId: ctx.environment.id }, orderBy: { createdAt: "desc" } }),
    db.webhookEndpoint.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: { createdAt: "desc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 3 } },
    }),
  ]);

  const keyExample = `${ctx.environment.type === "production" ? "sk_prod" : "sk_dev"}_…`;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
  const issuedUrl = typeof query.webhook === "string" ? query.webhook : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Developers · API access"
        title="Wire it into your stack."
        description="Secret keys authenticate your backend. Agents get their own short-lived tokens. Nothing here shares credentials with the browser."
        actions={
          <>
            <Link href="/app/developers/openapi" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              OpenAPI
            </Link>
            <Link href="/app/developers/jwks" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              JWKS
            </Link>
            <Link href="/docs/api" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
              API docs
            </Link>
          </>
        }
      />

      {query.error ? (
        <Notice kind="error">
          {query.error === "permission"
            ? "Only owners and admins can manage keys and webhooks."
            : query.error === "url"
              ? "Enter a valid HTTPS URL for the webhook."
              : query.error === "events"
                ? "Pick at least one event to deliver."
                : "That change could not be saved."}
        </Notice>
      ) : null}
      {query.revoked ? <Notice kind="ok">API key revoked. Requests using it now fail authentication.</Notice> : null}
      {query.deleted ? <Notice kind="ok">Webhook deleted. No further deliveries will be attempted.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="API keys" hint={`${ctx.environment.type} environment`} bodyClassName="p-4">
            {canManage ? <ApiKeyCreator isProduction={ctx.isProduction} /> : (
              <p className="text-[12px] text-black/60 dark:text-muted-foreground">Your role is read-only for API keys.</p>
            )}

            <div className="mt-4 border-t border-black/10 pt-3 dark:border-border">
              {apiKeys.length ? (
                <div className="divide-y divide-black/10 dark:divide-border">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span className="font-mono text-[11px]">{key.prefix}…</span>
                      <span className="text-[12px]">{key.name}</span>
                      <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                        {key.type}
                      </span>
                      {key.revokedAt ? <StatusBadge status="revoked" /> : null}
                      <span className="ml-auto font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {key.lastUsedAt ? `used ${relativeTime(key.lastUsedAt)}` : "never used"}
                      </span>
                      {canManage && !key.revokedAt ? (
                        <form action={revokeApiKeyAction}>
                          <input type="hidden" name="apiKeyId" value={key.id} />
                          <ConfirmButton
                            message={`Revoke ${key.prefix}…? Services using it will start failing immediately.`}
                            className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline"
                          >
                            Revoke
                          </ConfirmButton>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-[12px] text-black/60 dark:text-muted-foreground">No API keys yet. Create one to call the platform API.</p>
              )}
            </div>
          </Panel>

          <Panel title="Webhooks" hint="Signed deliveries, retried on failure" bodyClassName="p-4">
            {issuedUrl ? (
              <div className="mb-4 border border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#245f47]">Signing secret — shown once</p>
                <pre className="mt-1 break-all font-mono text-[10px] text-[#245f47]">{issuedUrl}</pre>
                <p className="mt-1 text-[10px] text-[#245f47]/80">
                  Verify with <span className="font-mono">Authab-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;</span> over <span className="font-mono">&lt;ts&gt;.&lt;body&gt;</span>.
                </p>
              </div>
            ) : null}

            {canManage ? (
              <form action={createWebhookAction} className="space-y-3">
                <input
                  name="url"
                  type="url"
                  required
                  placeholder="https://example.com/hooks/authab"
                  className="w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label key={event.value} className="flex items-center gap-2 text-[11px]">
                      <input type="checkbox" name="events" value={event.value} className="size-3.5 accent-black" />
                      <span className="font-mono text-[10px]">{event.value}</span>
                    </label>
                  ))}
                </div>
                <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                  Add endpoint
                </button>
              </form>
            ) : null}

            <div className="mt-4 border-t border-black/10 pt-3 dark:border-border">
              {webhooks.length ? (
                <div className="space-y-3">
                  {webhooks.map((endpoint) => {
                    const events = JSON.parse(endpoint.eventsJson || "[]") as string[];
                    return (
                      <div key={endpoint.id} className="border border-black/10 p-3 dark:border-border">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={endpoint.status === "active" ? "active" : "paused"} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{endpoint.url}</span>
                          {canManage ? (
                            <form action={deleteWebhookAction}>
                              <input type="hidden" name="webhookId" value={endpoint.id} />
                              <ConfirmButton
                                message="Delete this webhook endpoint? Pending retries are discarded."
                                className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline"
                              >
                                Delete
                              </ConfirmButton>
                            </form>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {events.map((event) => (
                            <span key={event} className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] text-black/60 dark:border-border dark:text-muted-foreground">
                              {event}
                            </span>
                          ))}
                        </div>
                        {endpoint.deliveries.length ? (
                          <div className="mt-2 space-y-1 border-t border-black/10 pt-2 dark:border-border">
                            {endpoint.deliveries.map((delivery) => (
                              <div key={delivery.id} className="flex items-center gap-2 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                                <span className={delivery.deliveredAt ? "text-[#276a4e] dark:text-[#7fd1ab]" : "text-[#8c3225] dark:text-[#f0a396]"}>
                                  {delivery.statusCode ?? "ERR"}
                                </span>
                                <span className="truncate">{delivery.event}</span>
                                <span className="ml-auto">{relativeTime(delivery.createdAt)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 font-mono text-[9px] text-black/60 dark:text-muted-foreground">No deliveries yet.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-2 text-[12px] text-black/60 dark:text-muted-foreground">No webhook endpoints. Add one to react to approvals and calls.</p>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Authenticate" hint="One header, three key types" bodyClassName="p-0">
            <div className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <div className="px-4 py-3">
                <p className="font-mono text-[10px]">Authorization: Bearer {keyExample}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Secret key for platform endpoints such as agents, grants and vault.
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="font-mono text-[10px]">Authorization: Bearer &lt;agent-jwt&gt;</p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Agent token for the proxy. Scopes come from grants, TTL is minutes, never days.
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="font-mono text-[10px]">Authorization: Bearer pk_…</p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Publishable key for browser flows. It cannot mint tokens or read the vault.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Quick start" hint="Call the proxy from an agent" bodyClassName="p-0">
            <pre className="overflow-auto bg-[#0b0b0b] p-4 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">{`curl -X POST ${origin}/api/v1/proxy/slack \\
  -H "Authorization: Bearer $AUTHAB_AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "action": "slack.post_message",
    "resource": "support-alerts",
    "input": { "channel": "#support", "text": "Tier-1 queue is clear." }
  }'`}</pre>
            <p className="px-4 py-2.5 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
              A <span className="font-mono">202</span> means approval is pending. Poll the approval or wait for the signed webhook.
            </p>
          </Panel>

          <Panel title="Tooling" hint="Ship without hand-rolling crypto" bodyClassName="p-4">
            <div className="space-y-2.5">
              {[
                { title: "TypeScript SDK", detail: "@authab/sdk — typed clients, token cache, idempotent proxy calls.", href: "/docs/sdk" },
                { title: "CLI", detail: "authab agents list, authab token issue, authab audit tail.", href: "/docs/cli" },
                { title: "MCP server", detail: "Expose governed tools to Claude, Cursor and other MCP hosts.", href: "/docs/mcp" },
              ].map((item) => (
                <Link key={item.title} href={item.href} className="block border border-black/10 p-3 transition-colors hover:border-black/35 dark:border-border">
                  <p className="text-[12px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">{item.detail}</p>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
