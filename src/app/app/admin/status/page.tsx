import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import {
  IMPACT_META,
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  STATUS_COMPONENTS,
  isIncidentImpact,
  isIncidentStatus,
  sortOpenIncidents,
} from "@/lib/status";
import { Notice, PageHeader, Panel, Stat, formatDate, relativeTime } from "@/components/app/ui";
import { createIncidentAction, postIncidentUpdateAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Status page admin" };

const ERRORS: Record<string, string> = {
  fields: "An incident needs a title and a description of at least a few characters.",
  component: "Choose one of the monitored components.",
  impact: "Choose a valid impact level.",
  status: "Choose a valid status. New incidents cannot start as resolved.",
  missing: "That incident no longer exists.",
};

const labelClass =
  "font-mono text-[9px] uppercase tracking-[0.16em] text-black/65 dark:text-muted-foreground";
const inputClass =
  "mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background";

const STATE_ORDER = ["investigating", "identified", "monitoring", "resolved"] as const;

export default async function StatusAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  if (!ctx.user.isPlatformAdmin) notFound();
  const query = await searchParams;

  const since = new Date(Date.now() - 30 * 86_400_000);
  const [open, recent] = await Promise.all([
    db.incident.findMany({
      where: { resolvedAt: null },
      include: { updates: { orderBy: { createdAt: "asc" } } },
      orderBy: { startedAt: "desc" },
    }),
    db.incident.findMany({
      where: { resolvedAt: { not: null, gte: since } },
      include: { updates: { orderBy: { createdAt: "asc" } } },
      orderBy: { resolvedAt: "desc" },
      take: 30,
    }),
  ]);

  const highestImpact = (() => {
    if (!open.length) return "None";
    const impact = sortOpenIncidents(open)[0].impact;
    return isIncidentImpact(impact) ? IMPACT_META[impact].label : "Minor";
  })();

  return (
    <div>
      <PageHeader
        eyebrow="Operate · status page"
        title="Tell the truth, on time."
        description="Incidents published here appear on the public status page immediately. Every count and timestamp comes from the database; nothing on this page is generated copy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/status"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Public status page
            </Link>
            <Link
              href="/app/observability"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Observability
            </Link>
          </div>
        }
      />

      {query.error ? <Notice kind="error">{ERRORS[query.error] ?? "That change could not be saved."}</Notice> : null}
      {query.created ? <Notice kind="ok">Incident published on the status page.</Notice> : null}
      {query.updated ? <Notice kind="ok">Update published.</Notice> : null}
      {query.resolved ? <Notice kind="ok">Incident resolved and moved to history.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open incidents" value={open.length} detail={open.length ? "Visible on /status" : "Status page clean"} accent />
        <Stat label="Resolved · 30d" value={recent.length} detail="Kept in public history" />
        <Stat
          label="Highest impact"
          value={highestImpact}
          detail={open.length ? "Among open incidents" : "No open incidents"}
        />
        <Stat label="Components" value={STATUS_COMPONENTS.length} detail="Checked live on every /status request" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        <div className="space-y-6">
          <Panel title="Open incidents" hint="Publicly visible until resolved" bodyClassName="p-0">
            {open.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {open.map((incident) => (
                  <div key={incident.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{incident.title}</p>
                        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                          {incident.component} · {IMPACT_META[isIncidentImpact(incident.impact) ? incident.impact : "minor"].label} ·{" "}
                          {isIncidentStatus(incident.status) ? INCIDENT_STATUS_LABELS[incident.status] : incident.status} · opened{" "}
                          {relativeTime(incident.startedAt)}
                        </p>
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8a5600] dark:text-[#e8b26a]">
                        {incident.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
                      {incident.body}
                    </p>

                    {incident.updates.length ? (
                      <div className="mt-3 space-y-2 border-l border-black/10 pl-3 dark:border-border">
                        {incident.updates.map((update) => (
                          <div key={update.id}>
                            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                              {isIncidentStatus(update.status) ? INCIDENT_STATUS_LABELS[update.status] : update.status} ·{" "}
                              {formatDate(update.createdAt)}
                            </p>
                            <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                              {update.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <form action={postIncidentUpdateAction} className="mt-3 space-y-2 border-t border-black/10 pt-3 dark:border-border">
                      <input type="hidden" name="incidentId" value={incident.id} />
                      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                        <select name="status" defaultValue="monitoring" className={inputClass} aria-label="New status">
                          {STATE_ORDER.map((status) => (
                            <option key={status} value={status}>
                              {INCIDENT_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <input
                          name="body"
                          required
                          maxLength={4000}
                          placeholder="What changed, and what customers should do"
                          className={inputClass}
                        />
                      </div>
                      <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                        Publish update
                      </button>
                      <span className="ml-2 text-[10px] text-black/60 dark:text-muted-foreground">
                        Choosing Resolved closes the incident and moves it to history.
                      </span>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8">
                <p className="text-[13px] font-medium">No open incidents.</p>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  The public status page currently reports each component from a live check. Publish an incident only when
                  customers are actually affected; cosmetic or internal-only issues belong in the changelog.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Resolved · last 30 days" hint="Public incident history" bodyClassName="p-0">
            {recent.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {recent.map((incident) => (
                  <div key={incident.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-medium">{incident.title}</p>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#276a4e] dark:text-[#7fd1ab]">
                        Resolved {formatDate(incident.resolvedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                      {incident.component} · {IMPACT_META[isIncidentImpact(incident.impact) ? incident.impact : "minor"].label} ·{" "}
                      {incident.updates.length} update{incident.updates.length === 1 ? "" : "s"}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                        View timeline
                      </summary>
                      <div className="mt-2 space-y-2 border-l border-black/10 pl-3 dark:border-border">
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                            Investigating · {formatDate(incident.startedAt)}
                          </p>
                          <p className="whitespace-pre-line text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                            {incident.body}
                          </p>
                        </div>
                        {incident.updates.map((update) => (
                          <div key={update.id}>
                            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                              {isIncidentStatus(update.status) ? INCIDENT_STATUS_LABELS[update.status] : update.status} ·{" "}
                              {formatDate(update.createdAt)}
                            </p>
                            <p className="whitespace-pre-line text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                              {update.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6">
                <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  No resolved incidents in the last 30 days. Resolved incidents stay public in this history.
                </p>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Open an incident" hint="Publishes immediately" bodyClassName="p-4">
            <form action={createIncidentAction} className="space-y-3">
              <div>
                <label className={labelClass} htmlFor="incident-title">Title</label>
                <input id="incident-title" name="title" required maxLength={140} placeholder="Elevated proxy latency in Singapore" className={inputClass} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="incident-component">Component</label>
                  <select id="incident-component" name="component" defaultValue="Control plane" className={inputClass}>
                    {STATUS_COMPONENTS.map((component) => (
                      <option key={component} value={component}>
                        {component}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="incident-impact">Impact</label>
                  <select id="incident-impact" name="impact" defaultValue="minor" className={inputClass}>
                    {INCIDENT_IMPACTS.map((impact) => (
                      <option key={impact} value={impact}>
                        {IMPACT_META[impact].label} — {IMPACT_META[impact].detail}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="incident-status">Initial status</label>
                <select id="incident-status" name="status" defaultValue="investigating" className={inputClass}>
                  {INCIDENT_STATUSES.filter((status) => status !== "resolved").map((status) => (
                    <option key={status} value={status}>
                      {INCIDENT_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="incident-body">Customer-facing summary</label>
                <textarea
                  id="incident-body"
                  name="body"
                  required
                  rows={4}
                  maxLength={4000}
                  placeholder="What is affected, what we know, and what customers should do. No internal hostnames or customer names."
                  className={inputClass}
                />
              </div>
              <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                Publish incident
              </button>
            </form>
          </Panel>

          <Panel title="Only platform admins" hint="user.isPlatformAdmin" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
              Status incidents are platform-wide, not scoped to a workspace. This page is hidden from every other account,
              and the actions re-check the flag server-side. Changes are written to the audit chain of your active
              environment as <span className="font-mono">incident.created</span>,{" "}
              <span className="font-mono">incident.updated</span> and <span className="font-mono">incident.resolved</span>.
            </p>
            <p className="mt-3 border-t border-black/10 pt-3 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground dark:border-border">
              Public incident copy is factual and time-stamped. Never claim a fix before verification, never include
              customer or tenant names, and resolve only after the live check and provider SLOs have stayed healthy.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
