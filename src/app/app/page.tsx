import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { actionLabel } from "@/lib/audit";
import { connector } from "@/lib/connectors";
import { planFor } from "@/lib/plans";
import { PageHeader, Stat, Panel, StatusBadge, RiskBadge, relativeTime, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await getContext();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [agents, credentials, pending, recent, monthUsage, dayEvents] = await Promise.all([
    db.agent.findMany({
      where: { environmentId: ctx.environment.id },
      include: { grants: true },
      orderBy: { lastActiveAt: "desc" },
      take: 6,
    }),
    db.credential.findMany({ where: { environmentId: ctx.environment.id } }),
    db.approvalRequest.findMany({
      where: { environmentId: ctx.environment.id, status: "pending", expiresAt: { gt: new Date() } },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    db.auditEvent.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: { seq: "desc" },
      take: 8,
    }),
    db.usageRecord.findFirst({
      where: { orgId: ctx.org.id, metric: "proxy_calls", period: new Date().toISOString().slice(0, 7) },
    }),
    db.auditEvent.findMany({
      where: { environmentId: ctx.environment.id, action: "proxy.call", timestamp: { gte: since } },
      select: { timestamp: true },
    }),
  ]);

  const plan = planFor(ctx.org.plan);
  const usedCalls = monthUsage?.quantity ?? 0;
  const callLimit = plan.limits.callsPerMonth;
  const callPercent = callLimit > 0 ? Math.min(100, Math.round((usedCalls / callLimit) * 100)) : 0;
  const activeAgents = agents.filter((agent) => agent.status === "active").length;
  const broken = credentials.filter((c) => c.status === "broken" || c.status === "expiring" || (c.expiresAt && c.expiresAt < new Date(Date.now() + 3 * 86400_000)));
  const unverified = credentials.filter((c) => !c.revokedAt && c.status === "unverified").length;

  const buckets = Array.from({ length: 24 }, (_, index) => {
    const start = new Date(since.getTime() + index * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return dayEvents.filter((event) => event.timestamp >= start && event.timestamp < end).length;
  });
  const peak = Math.max(...buckets, 1);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = ctx.user.name.split(" ")[0];

  return (
    <div>
      <PageHeader
        eyebrow={`${ctx.environment.type === "production" ? "Production" : "Development"} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}`}
        title={`${greeting}, ${firstName}.`}
        description={
          pending.length
            ? `${pending.length} approval${pending.length === 1 ? "" : "s"} are waiting on a human decision. Everything else is moving.`
            : "The fleet is quiet. Every call is attributed, and every credential stays in the vault."
        }
        actions={
          <>
            <Link
              href="/app/approvals"
              className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card"
            >
              Approvals {pending.length ? `(${pending.length})` : ""}
            </Link>
            <Link
              href="/app/agents/new"
              className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
            >
              Register agent
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active agents" value={activeAgents} detail={`${agents.length} identities in this environment`} accent />
        <Stat label="Calls this month" value={usedCalls.toLocaleString("en-IN")} detail={callLimit > 0 ? `${callPercent}% of ${callLimit.toLocaleString("en-IN")} included` : "Unlimited"} />
        <Stat label="Connections" value={credentials.filter((c) => !c.revokedAt).length} detail={broken.length ? `${broken.length} need attention` : unverified ? `${unverified} unverified` : "All verified"} />
        <Stat label="Pending approvals" value={pending.length} detail={pending.length ? "Oldest needs a decision" : "Nothing waiting"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-6">
          <Panel
            title="The fleet"
            hint="Identities in this environment"
            actions={
              <Link href="/app/agents" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                All agents
              </Link>
            }
            bodyClassName="p-0"
          >
            {agents.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {agents.map((agent) => (
                  <Link
                    key={agent.id}
                    href={`/app/agents/${agent.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.02]"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center border border-black/15 bg-[#faf9f6] font-mono text-[10px] dark:border-border dark:bg-background">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px]">{agent.name}</p>
                        <StatusBadge status={agent.status} />
                      </div>
                      <p className="truncate font-mono text-[10px] text-black/40 dark:text-muted-foreground">
                        {agent.grants.length} grant{agent.grants.length === 1 ? "" : "s"} · {agent.framework ?? "framework-less"}
                      </p>
                    </div>
                    <span className="hidden font-mono text-[10px] text-black/40 dark:text-muted-foreground sm:block">
                      {agent.lastActiveAt ? relativeTime(agent.lastActiveAt) : "never active"}
                    </span>
                    <span className="font-mono text-[10px] text-black/30">→</span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No agents yet"
                description="Register an agent to give it an Ed25519 identity, short-lived tokens and a boundary."
                action={
                  <Link href="/app/agents/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                    Register the first agent
                  </Link>
                }
              />
            )}
          </Panel>

          <Panel title="Proxy volume" hint="Last 24 hours" bodyClassName="px-4 pb-4 pt-5">
            <div className="flex h-24 items-end gap-1">
              {buckets.map((count, index) => (
                <div
                  key={index}
                  className={`flex-1 ${count ? "bg-black dark:bg-foreground" : "bg-black/10 dark:bg-white/10"}`}
                  style={{ height: `${Math.max(6, (count / peak) * 100)}%` }}
                  title={`${count} calls`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-black/35 dark:text-muted-foreground">
              <span>24h ago</span>
              <span>{dayEvents.length} calls</span>
              <span>now</span>
            </div>
          </Panel>

          <Panel
            title="Recent activity"
            hint="Hash-chained audit trail"
            actions={
              <Link href="/app/activity" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                Full log
              </Link>
            }
            bodyClassName="p-0"
          >
            <div className="divide-y divide-black/10 dark:divide-border">
              {recent.length ? (
                recent.map((event) => (
                  <div key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-14 shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
                      {relativeTime(event.timestamp)}
                    </span>
                    <StatusBadge status={event.outcome} />
                    <p className="min-w-0 flex-1 truncate text-[12px]">
                      <span className="font-medium">{actionLabel(event.action)}</span>
                      <span className="text-black/45 dark:text-muted-foreground"> · {event.actorName}</span>
                    </p>
                    <span className="hidden font-mono text-[10px] text-black/35 dark:text-muted-foreground md:block">
                      {event.resourceType}
                    </span>
                  </div>
                ))
              ) : (
                <p className="px-4 py-6 text-[12px] text-black/45 dark:text-muted-foreground">No activity recorded yet.</p>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Waiting on you"
            hint="Approvals inbox"
            actions={
              <Link href="/app/approvals" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                Open
              </Link>
            }
            bodyClassName="p-0"
          >
            {pending.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {pending.map((approval) => (
                  <Link
                    key={approval.id}
                    href={`/app/approvals/${approval.id}`}
                    className="block px-4 py-3 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-2">
                      <RiskBadge risk={approval.risk} />
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
                        {relativeTime(approval.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug">{approval.summary}</p>
                    <p className="mt-1 font-mono text-[9px] text-black/35 dark:text-muted-foreground">{approval.agent.name}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="font-display text-xl tracking-tight">Inbox zero.</p>
                <p className="mt-1 text-[12px] text-black/45 dark:text-muted-foreground">Nothing is blocked on a human.</p>
              </div>
            )}
          </Panel>

          <Panel
            title="Vault health"
            hint="Connections in this environment"
            actions={
              <Link href="/app/vault" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                Vault
              </Link>
            }
            bodyClassName="p-0"
          >
            <div className="divide-y divide-black/10 dark:divide-border">
              {credentials.slice(0, 5).map((credential) => {
                const def = connector(credential.connectorSlug);
                const expiringSoon = credential.expiresAt && credential.expiresAt < new Date(Date.now() + 7 * 86400_000);
                return (
                  <Link
                    key={credential.id}
                    href={`/app/vault/${credential.id}`}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-black/[0.025] dark:hover:bg-white/[0.02]"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: def?.color ?? "#999" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px]">{credential.name}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:text-muted-foreground">
                        {def?.name ?? credential.connectorSlug}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] text-black/40 dark:text-muted-foreground">
                      {credential.status === "broken"
                        ? "broken"
                        : credential.expiresAt
                          ? expiringSoon
                            ? `expires ${relativeTime(credential.expiresAt)}`
                            : formatExpiry(credential.expiresAt)
                          : credential.status}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Panel>

          <Panel title="Usage" hint={`${plan.name} plan`} bodyClassName="p-4">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-2xl tracking-tight">{usedCalls.toLocaleString("en-IN")}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">
                {callLimit > 0 ? `of ${callLimit.toLocaleString("en-IN")}` : "unlimited"}
              </p>
            </div>
            <div className="mt-2 h-1.5 bg-black/10 dark:bg-white/10">
              <div className="h-full bg-black dark:bg-foreground" style={{ width: `${callPercent}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-black/45 dark:text-muted-foreground">
              Proxy calls this month. {plan.name === "free" ? "Upgrade for production and 50k calls." : "Calls beyond the allowance are refused, not billed over."}
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/app/billing" className="border border-black/15 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-border">
                Billing
              </Link>
              {ctx.environment.type === "development" && (
                <Link href="/app/agents" className="border border-black/15 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-border">
                  Promote to prod
                </Link>
              )}
            </div>
          </Panel>

          <div className="border border-black/10 bg-[#0b0b0b] p-4 text-[#e8e6e1] dark:border-border">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">Quickstart</p>
            <pre className="mt-3 overflow-x-auto text-[10px] leading-relaxed text-[#cfcdc6]">{`const keel = new Keel("sk_dev_…");

const token = await keel.agents.token("agt_atlas");

await keel.proxy.call(token, "slack", {
  action: "slack.post_message",
  input: { channel: "#research", text: "…" },
});`}</pre>
            <Link href="/app/developers" className="mt-3 inline-block font-mono text-[9px] uppercase tracking-[0.16em] text-[#eca8d6] underline">
              Developer quickstart
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatExpiry(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
