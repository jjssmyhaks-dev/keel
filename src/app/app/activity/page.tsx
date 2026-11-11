import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { actionLabel } from "@/lib/audit";
import { verifyAuditAction } from "@/app/app/actions";
import { PageHeader, Panel, Stat, StatusBadge, RiskBadge, Notice, relativeTime, formatDate, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Activity" };

const PAGE_SIZE = 40;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;

  const agentId = query.agentId || undefined;
  const action = query.action || undefined;
  const outcome = query.outcome || undefined;
  const before = Number(query.before || 0) || undefined;

  const where = {
    environmentId: ctx.environment.id,
    ...(agentId ? { agentId } : {}),
    ...(action ? { action } : {}),
    ...(outcome ? { outcome } : {}),
    ...(before ? { seq: { lt: before } } : {}),
  };

  const [events, agents, total] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { seq: "desc" }, take: PAGE_SIZE + 1 }),
    db.agent.findMany({
      where: { environmentId: ctx.environment.id },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    db.auditEvent.count({ where: { environmentId: ctx.environment.id } }),
  ]);

  const hasMore = events.length > PAGE_SIZE;
  const rows = hasMore ? events.slice(0, PAGE_SIZE) : events;
  const lastSeq = rows.length ? rows[rows.length - 1].seq : undefined;
  const nextHref = (() => {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    if (action) params.set("action", action);
    if (outcome) params.set("outcome", outcome);
    if (lastSeq) params.set("before", String(lastSeq));
    const qs = params.toString();
    return `/app/activity${qs ? `?${qs}` : ""}`;
  })();
  const filterQS = (() => {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    if (action) params.set("action", action);
    if (outcome) params.set("outcome", outcome);
    return params.toString();
  })();

  const denied = await db.auditEvent.count({ where: { environmentId: ctx.environment.id, outcome: "denied" } });
  const calls = await db.auditEvent.count({ where: { environmentId: ctx.environment.id, action: "proxy.call" } });
  const uniqueActions = await db.auditEvent.groupBy({
    by: ["action"],
    where: { environmentId: ctx.environment.id },
    _count: { _all: true },
  });
  const topActions = uniqueActions.sort((a, b) => b._count._all - a._count._all).slice(0, 6);
  const filtered = Boolean(agentId || action || outcome);

  return (
    <div>
      <PageHeader
        eyebrow="Activity · tamper-evident"
        title="Every call leaves a mark."
        description="Events are hash-chained inside the environment. If one row changes, verification fails at the exact sequence number."
        actions={
          <>
            <form action={verifyAuditAction}>
              <input type="hidden" name="back" value="/app/activity" />
              <button className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
                Verify chain
              </button>
            </form>
            <a
              href={`/app/activity/export?format=csv${filterQS ? `&${filterQS}` : ""}`}
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              CSV
            </a>
            <a
              href={`/app/activity/export?format=jsonl${filterQS ? `&${filterQS}` : ""}`}
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              JSONL
            </a>
          </>
        }
      />

      {query.verified === "ok" ? (
        <Notice kind="ok">Chain verified — {query.checked} event{query.checked === "1" ? "" : "s"} recomputed and matched.</Notice>
      ) : null}
      {query.verified === "broken" ? (
        <Notice kind="error">Chain verification failed. Restore from an export and investigate before trusting this environment.</Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events" value={total} detail={`${uniqueActions.length} distinct types`} accent />
        <Stat label="Proxy calls" value={calls} detail="Executed, approved or denied" />
        <Stat label="Denied" value={denied} detail={total ? `${Math.round((denied / total) * 100)}% of events` : "Nothing blocked"} />
        <Stat label="Latest" value={rows[0] ? `#${rows[0].seq}` : "—"} detail={rows[0] ? relativeTime(rows[0].timestamp) : "No events"} />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2 border-b border-black/10 pb-3 dark:border-border">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Agent</label>
            <select
              name="agentId"
              defaultValue={agentId ?? ""}
              className="mt-1 block border border-black/45 bg-white px-2 py-1 text-[11px] dark:border-white/40 dark:bg-card"
            >
              <option value="">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Action</label>
            <select
              name="action"
              defaultValue={action ?? ""}
              className="mt-1 block border border-black/45 bg-white px-2 py-1 text-[11px] dark:border-white/40 dark:bg-card"
            >
              <option value="">All actions</option>
              {uniqueActions
                .sort((a, b) => a.action.localeCompare(b.action))
                .map((row) => (
                  <option key={row.action} value={row.action}>
                    {actionLabel(row.action)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Outcome</label>
            <select
              name="outcome"
              defaultValue={outcome ?? ""}
              className="mt-1 block border border-black/45 bg-white px-2 py-1 text-[11px] dark:border-white/40 dark:bg-card"
            >
              <option value="">Any outcome</option>
              {["allowed", "approved", "denied", "error", "recorded"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
            Apply
          </button>
          {filtered ? (
            <Link href="/app/activity" className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] underline">
              Clear
            </Link>
          ) : null}
        </form>
        {topActions.length ? (
          <div className="ml-auto hidden items-center gap-1.5 lg:flex">
            {topActions.slice(0, 3).map((row) => (
              <Link
                key={row.action}
                href={`/app/activity?action=${row.action}`}
                className="border border-black/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 hover:border-black dark:border-border dark:text-muted-foreground"
              >
                {actionLabel(row.action)} <span>{row._count._all}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        {rows.length ? (
          <div className="border border-black/10 bg-white dark:border-border dark:bg-card">
            <div className="hidden grid-cols-[80px_1fr_150px_110px_120px] gap-3 border-b border-black/10 px-4 py-2 font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:border-border dark:text-muted-foreground md:grid">
              <span>Seq</span>
              <span>Event</span>
              <span>Actor</span>
              <span>Outcome</span>
              <span className="text-right">When</span>
            </div>
            <div className="divide-y divide-black/10 dark:divide-border">
              {rows.map((event) => {
                const payload = (() => {
                  try {
                    return JSON.parse(event.payloadSummary || "{}") as Record<string, unknown>;
                  } catch {
                    return {} as Record<string, unknown>;
                  }
                })();
                const summary =
                  typeof payload.action === "string"
                    ? payload.action
                    : typeof payload.summary === "string"
                      ? payload.summary
                      : typeof payload.name === "string"
                        ? payload.name
                        : "";
                const resource = typeof payload.resource === "string" ? payload.resource : null;
                const risk = typeof payload.risk === "string" ? payload.risk : null;
                return (
                  <details key={event.id} className="group">
                    <summary className="grid cursor-pointer grid-cols-1 gap-1.5 px-4 py-2.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] md:grid-cols-[80px_1fr_150px_110px_120px] md:items-center md:gap-3">
                      <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">#{event.seq}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="text-[12px]">{actionLabel(event.action)}</span>
                        {summary ? (
                          <span className="truncate font-mono text-[9px] text-black/60 dark:text-muted-foreground">{summary}</span>
                        ) : null}
                        {risk ? <RiskBadge risk={risk} /> : null}
                        {resource ? (
                          <span className="hidden max-w-[180px] truncate font-mono text-[9px] text-black/60 dark:text-muted-foreground lg:inline">
                            {resource}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        <span className="border border-black/10 px-1 uppercase tracking-[0.08em] dark:border-border">{event.actorType}</span>
                        <span className="truncate">{event.actorName}</span>
                      </span>
                      <span>
                        <StatusBadge status={event.outcome} />
                      </span>
                      <span className="text-left font-mono text-[9px] text-black/60 dark:text-muted-foreground md:text-right">
                        {formatDate(event.timestamp)}
                      </span>
                    </summary>
                    <div className="border-t border-black/10 bg-[#faf9f6] px-4 py-3 dark:border-border dark:bg-background">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Payload</p>
                          <pre className="mt-1 max-h-40 overflow-auto border border-black/10 bg-[#0b0b0b] p-2.5 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">
                            {JSON.stringify(payload, null, 2)}
                          </pre>
                        </div>
                        <dl className="space-y-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          <div className="flex justify-between gap-3">
                            <dt>Request</dt>
                            <dd className="truncate text-right">{event.requestId}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Resource</dt>
                            <dd className="truncate text-right">
                              {event.resourceType}
                              {event.resourceId ? ` · ${event.resourceId}` : ""}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>IP</dt>
                            <dd>{event.ip ?? "—"}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Prev hash</dt>
                            <dd className="truncate text-right">{event.prevHash.slice(0, 20)}…</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Hash</dt>
                            <dd className="truncate text-right">{event.hash.slice(0, 20)}…</dd>
                          </div>
                          {event.agentId ? (
                            <div className="flex justify-between gap-3">
                              <dt>Agent</dt>
                              <dd>
                                <Link href={`/app/agents/${event.agentId}`} className="underline">
                                  open
                                </Link>
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        <Link
                          href={`/app/activity/${event.id}`}
                          className="mt-3 inline-block border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black"
                        >
                          {event.action === "proxy.call" || event.action === "sandbox.call"
                            ? "Call trust view"
                            : "Event detail"}
                        </Link>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ) : (
          <Panel bodyClassName="p-0">
            <EmptyState
              title="No events match"
              description="Clear the filters or make a call through the proxy to populate the trail."
              action={
                <Link href="/app/activity" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                  Clear filters
                </Link>
              }
            />
          </Panel>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
          Showing {rows.length} event{rows.length === 1 ? "" : "s"} · newest first
        </p>
        {hasMore ? (
          <Link href={nextHref} className="border border-black/45 bg-white px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-white/40 dark:bg-card">
            Older →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
