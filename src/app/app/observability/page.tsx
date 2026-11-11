import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { connector } from "@/lib/connectors";
import { sampleFromAudit, summarizeSlo, type SloSample, type SloSummary } from "@/lib/slo";
import { telemetryConfigured } from "@/lib/tracing";
import { resolveAllErrorsAction, resolveErrorAction } from "./actions";
import { Notice, PageHeader, Panel, Stat, StatusBadge, formatDate, relativeTime } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Observability" };

const TARGET = 0.995;
const WINDOW_DAYS = 7;
const MAX_EVENTS = 5000;

type ProviderRow = {
  slug: string;
  name: string;
  actions: string[];
  summary: SloSummary;
  lastAt: Date;
};

function percent(value: number | null) {
  if (value === null) return "—";
  return `${(value * 100).toFixed(value === 1 ? 0 : 2)}%`;
}

function duration(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function budgetClass(used: number | null) {
  if (used === null) return "bg-black/20 dark:bg-white/20";
  if (used <= 1) return "bg-[#2f7d5c]";
  if (used <= 2) return "bg-[#a56b18]";
  return "bg-[#b3402f]";
}

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const canManage = ctx.capabilities.manageSecurity;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const since24h = new Date(Date.now() - 86_400_000);

  const [events, recentErrors, openErrors, errors24h] = await Promise.all([
    db.auditEvent.findMany({
      where: {
        environmentId: ctx.environment.id,
        action: { in: ["proxy.call", "credential.checked"] },
        timestamp: { gte: since },
      },
      orderBy: { seq: "desc" },
      take: MAX_EVENTS,
      select: { payloadSummary: true, outcome: true, resourceId: true, timestamp: true },
    }),
    db.errorEvent.findMany({
      where: { orgId: ctx.org.id },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.errorEvent.count({ where: { orgId: ctx.org.id, resolvedAt: null } }),
    db.errorEvent.count({ where: { orgId: ctx.org.id, createdAt: { gte: since24h } } }),
  ]);

  const groups = new Map<string, { samples: SloSample[]; actions: Set<string>; lastAt: Date }>();
  const allSamples: SloSample[] = [];
  let tracedCalls = 0;

  for (const event of events) {
    const slug = event.resourceId ?? "unknown";
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(event.payloadSummary || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (typeof payload.traceId === "string") tracedCalls += 1;
    const sample = sampleFromAudit(event.payloadSummary, event.outcome);
    if (!sample) continue;
    allSamples.push(sample);
    let group = groups.get(slug);
    if (!group) {
      group = { samples: [], actions: new Set(), lastAt: event.timestamp };
      groups.set(slug, group);
    }
    group.samples.push(sample);
    if (typeof payload.action === "string") group.actions.add(payload.action);
  }

  const providers: ProviderRow[] = [...groups.entries()]
    .map(([slug, group]) => ({
      slug,
      name: connector(slug)?.name ?? slug,
      actions: [...group.actions].sort(),
      summary: summarizeSlo(group.samples, TARGET),
      lastAt: group.lastAt,
    }))
    .sort((a, b) => b.summary.calls - a.summary.calls);

  const totals = summarizeSlo(allSamples, TARGET);
  const otlp = telemetryConfigured();
  const newestError = recentErrors[0];
  const oldestError = recentErrors[recentErrors.length - 1];

  return (
    <div>
      <PageHeader
        eyebrow={`Observability · ${ctx.environment.type} environment`}
        title="Know before your customers tell you."
        description="Provider error rates and latency come from the same audit records that gate calls. Unhandled server errors are captured with route, request ID and trace ID, and proxy spans export over OTLP when a collector is configured."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/activity"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Activity log
            </Link>
            <Link
              href="/app/security"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Security settings
            </Link>
          </div>
        }
      />

      {query.error === "permission" ? <Notice kind="error">Only owners and admins can resolve errors.</Notice> : null}
      {query.error === "missing" ? <Notice kind="error">That error record no longer exists.</Notice> : null}
      {query.saved ? <Notice kind="ok">Error marked resolved.</Notice> : null}
      {query.resolved ? <Notice kind="ok">{query.resolved} request errors marked resolved.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`Provider calls · ${WINDOW_DAYS}d`}
          value={totals.calls}
          detail={events.length >= MAX_EVENTS ? `Most recent ${MAX_EVENTS.toLocaleString()} records` : "Proxy and health-check calls"}
          accent
        />
        <Stat
          label="Availability"
          value={percent(totals.availability)}
          detail={`${percent(1 - TARGET)} error budget · ${totals.errors} failed`}
        />
        <Stat label="P95 latency" value={duration(totals.p95Ms)} detail="Provider round trip" />
        <Stat label="Open errors" value={openErrors} detail={`${errors24h} in the last 24h`} />
      </div>

      <div className="mt-6 space-y-6">
        <Panel
          title="Provider SLOs"
          hint={`Last ${WINDOW_DAYS} days · availability target ${percent(TARGET)}`}
          bodyClassName="p-0"
        >
          {providers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="border-b border-black/10 font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:border-border dark:text-muted-foreground">
                    <th className="px-4 py-2 font-normal">Provider</th>
                    <th className="px-3 py-2 font-normal">Calls</th>
                    <th className="px-3 py-2 font-normal">Failures</th>
                    <th className="px-3 py-2 font-normal">Availability</th>
                    <th className="px-3 py-2 font-normal">P50</th>
                    <th className="px-3 py-2 font-normal">P95</th>
                    <th className="px-4 py-2 font-normal">Error budget</th>
                    <th className="px-4 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10 dark:divide-border">
                  {providers.map((provider) => {
                    const used = provider.summary.budgetUsed;
                    return (
                      <tr key={provider.slug} className="align-middle">
                        <td className="px-4 py-3">
                          <p className="text-[12px] font-medium">{provider.name}</p>
                          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                            {provider.actions.slice(0, 3).join(" · ") || provider.slug}
                            {provider.actions.length > 3 ? ` +${provider.actions.length - 3}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px]">{provider.summary.calls}</td>
                        <td className="px-3 py-3 font-mono text-[11px]">{provider.summary.errors}</td>
                        <td className="px-3 py-3 font-mono text-[11px]">{percent(provider.summary.availability)}</td>
                        <td className="px-3 py-3 font-mono text-[11px]">{duration(provider.summary.p50Ms)}</td>
                        <td className="px-3 py-3 font-mono text-[11px]">{duration(provider.summary.p95Ms)}</td>
                        <td className="px-4 py-3">
                          <div className="h-1.5 w-28 bg-black/10 dark:bg-white/10">
                            <div
                              className={`h-full ${budgetClass(used)}`}
                              style={{ width: `${Math.min(100, Math.max(0, (used ?? 0) * 100))}%` }}
                            />
                          </div>
                          <p className="mt-1 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                            {used === null ? "no samples" : `${(used * 100).toFixed(0)}% used`}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={provider.summary.status} />
                          <p className="mt-1 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                            {relativeTime(provider.lastAt)}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8">
              <p className="text-[13px] font-medium">No provider traffic yet.</p>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                Once an agent proxies a call or a credential health check runs, this table shows real availability,
                failure counts and p50/p95 latency from the audit log for this environment.
              </p>
              <Link
                href="/app/developers"
                className="mt-3 inline-block border border-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:bg-[#eca8d6] dark:border-border"
              >
                Proxy a call
              </Link>
            </div>
          )}
          <div className="border-t border-black/10 px-4 py-3 dark:border-border">
            <p className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Samples are audit records for <span className="font-mono">proxy.call</span> and{" "}
              <span className="font-mono">credential.checked</span> in this environment
              {events.length >= MAX_EVENTS ? `, capped at the most recent ${MAX_EVENTS.toLocaleString()}` : ""}. A failed
              call is a 4xx/5xx upstream response, a provider auth rejection or a network failure. Errors consume the{" "}
              {percent(1 - TARGET)} budget; at 100% the window is exactly at target.
            </p>
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Panel
            title="Request errors"
            hint="Unhandled server errors · 30 day retention"
            actions={
              canManage && openErrors > 0 ? (
                <form action={resolveAllErrorsAction}>
                  <button className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40">
                    Resolve all
                  </button>
                </form>
              ) : null
            }
            bodyClassName="p-0"
          >
            {recentErrors.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {recentErrors.map((error) => (
                  <div key={error.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={error.resolvedAt ? "resolved" : "open"} />
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        {error.method ?? "GET"} {error.route}
                      </span>
                      <span className="ml-auto font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {relativeTime(error.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 break-words text-[12px] leading-relaxed">{error.message}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                      <span>request {error.requestId}</span>
                      <span>{error.traceId ? `trace ${error.traceId}` : "no trace id"}</span>
                      {error.digest ? <span>digest {error.digest}</span> : null}
                      {error.resolvedAt ? <span>resolved {formatDate(error.resolvedAt)}</span> : null}
                    </div>
                    {error.stack ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                          Stack
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto border border-black/10 bg-[#0b0b0b] p-3 font-mono text-[9px] leading-relaxed text-[#e8e6e1] dark:border-border">
                          {error.stack}
                        </pre>
                      </details>
                    ) : null}
                    {canManage && !error.resolvedAt ? (
                      <form action={resolveErrorAction} className="mt-2">
                        <input type="hidden" name="errorId" value={error.id} />
                        <button className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40">
                          Mark resolved
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8">
                <p className="text-[13px] font-medium">No request errors recorded.</p>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Unhandled exceptions in server components, route handlers and server actions land here with the route,
                  request ID, trace ID and stack. Errors raised before a session resolves are stored without a workspace
                  and are not shown here.
                </p>
              </div>
            )}
            {oldestError ? (
              <div className="border-t border-black/10 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                Showing the latest {recentErrors.length} · oldest {formatDate(oldestError.createdAt)}
                {newestError ? ` · newest ${formatDate(newestError.createdAt)}` : ""}
              </div>
            ) : null}
          </Panel>

          <div className="space-y-6">
            <Panel title="Tracing" hint="OpenTelemetry · OTLP" bodyClassName="p-4">
              <div className="flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${otlp ? "bg-[#2f7d5c]" : "bg-black/30"}`} />
                <p className="text-[12px] font-medium">{otlp ? "OTLP export enabled" : "OTLP export disabled"}</p>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
                {otlp
                  ? "Proxy calls and captured request errors export as spans to the configured collector. Trace IDs below come from the exporter."
                  : "Spans are not exported until OTEL_EXPORTER_OTLP_ENDPOINT is set. Calls still pass any incoming traceparent through to error records."}
              </p>
              <div className="mt-3 border-t border-black/10 pt-3 dark:border-border">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
                  Trace coverage
                </p>
                <p className="mt-1 font-display text-2xl leading-none">
                  {tracedCalls}
                  <span className="text-[11px] text-black/60 dark:text-muted-foreground"> / {allSamples.length} calls</span>
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  {otlp
                    ? `Service ${process.env.OTEL_SERVICE_NAME || "authab"} · spans batched and exported.`
                    : "Carry trace context into Authab with a traceparent header; it is stored on every captured error."}
                </p>
              </div>
            </Panel>

            <Panel title="How errors are captured" hint="Instrumentation hook" bodyClassName="p-4">
              <ul className="space-y-2 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
                <li>Next.js reports unhandled render, route and action errors to the instrumentation hook.</li>
                <li>Each record keeps the route, method, request ID, digest and a bounded stack.</li>
                <li>When a session cookie is present the error is attributed to that workspace and environment.</li>
                <li>Records are pruned after 30 days by the scheduled cron job; resolving one keeps it for audit context.</li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
