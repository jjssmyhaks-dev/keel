import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getJwks } from "@/lib/jwt";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import {
  COMPONENT_STATE_LABELS,
  IMPACT_META,
  INCIDENT_STATUS_LABELS,
  OVERALL_META,
  componentState,
  isIncidentImpact,
  isIncidentStatus,
  overallState,
  sortOpenIncidents,
} from "@/lib/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status",
  description: "Live status for the Authab control plane, proxy, audit pipeline and published incidents.",
};

function timeAgo(date: Date) {
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function shortDate(date: Date) {
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

const STATE_TONE: Record<string, string> = {
  operational: "text-[#276a4e] dark:text-[#7fd1ab]",
  maintenance: "text-[#8a5600] dark:text-[#e8b26a]",
  degraded: "text-[#8c3225] dark:text-[#f0a396]",
  outage: "text-[#8c3225] dark:text-[#f0a396]",
};

const STATE_DOT: Record<string, string> = {
  operational: "bg-[#2f7d5c] live-dot",
  maintenance: "bg-[#a56b18]",
  degraded: "bg-[#8c3225]",
  outage: "bg-[#8c3225]",
};

export default async function StatusPage() {
  const checkedAt = new Date();
  let database = true;
  let environmentCount = 0;
  let openIncidents: Awaited<ReturnType<typeof loadOpenIncidents>> = [];
  let history: Awaited<ReturnType<typeof loadHistory>> = [];

  try {
    environmentCount = await db.environment.count();
    [openIncidents, history] = await Promise.all([loadOpenIncidents(), loadHistory()]);
  } catch {
    database = false;
  }

  let signing = true;
  try {
    const jwks = await getJwks();
    signing = Array.isArray(jwks.keys) && jwks.keys.length > 0;
  } catch {
    signing = false;
  }

  const liveChecks: Record<string, boolean> = {
    "Control plane": database,
    "Metadata store": database,
    "Agent proxy": database,
    "Audit pipeline": database,
    "Token signing": signing,
  };
  const componentDetails: Record<string, string> = {
    "Control plane": database ? "Dashboard, API keys, sessions" : "Health check failed",
    "Metadata store": database ? `${environmentCount} environments reachable` : "Database check failed",
    "Agent proxy": database
      ? "Live provider egress · policy, approvals and audit enforced"
      : "Proxy unavailable",
    "Audit pipeline": database ? "Hash-chained writes and export" : "Audit writes unavailable",
    "Token signing": signing
      ? "JWKS endpoint returns an Ed25519 key"
      : "Signing key unavailable — agent tokens cannot be issued",
  };
  const components = Object.keys(liveChecks).map((name) => {
    const state = database
      ? componentState(name, liveChecks[name], openIncidents)
      : "degraded";
    return { name, detail: componentDetails[name], state };
  });

  let overall = overallState(openIncidents);
  if (!database) overall = "outage";
  else if (overall === "operational" && components.some((component) => component.state !== "operational")) {
    overall = "degraded";
  }
  const overallMeta = OVERALL_META[overall];
  const sortedOpen = sortOpenIncidents(openIncidents);

  return (
    <main id="main-content" tabIndex={-1} className="relative">
      <Navigation />
      <div className="pt-28 lg:pt-36 pb-24">
        <div className="mx-auto max-w-[1000px] px-6 lg:px-12">
          <p className="mono-label text-foreground/60 mb-5">Status</p>
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-foreground/10 pb-10">
            <h1 className="font-display text-6xl lg:text-7xl leading-[0.9] tracking-tight">{overallMeta.headline}</h1>
            <div className="text-right">
              <span className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] ${STATE_TONE[overall]}`}>
                <span className={`size-2 rounded-full ${STATE_DOT[overall]}`} />
                {overallMeta.label}
              </span>
              <p className="mt-2 text-[11px] text-foreground/60">Checked {timeAgo(checkedAt)}</p>
            </div>
          </div>

          {!database ? (
            <p className="mt-6 border border-[#8c3225]/30 bg-[#8c3225]/[0.05] px-4 py-3 text-[12px] text-[#8c3225] dark:text-[#f0a396]">
              The control plane cannot reach its own database right now. Component checks below are failing, not unknown.
              If this persists, email support@authab.dev with the time you saw it.
            </p>
          ) : null}

          <div className="mt-10 divide-y divide-foreground/10 border border-foreground/12">
            {components.map((component) => (
              <div key={component.name} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-[14px]">{component.name}</p>
                  <p className="mt-0.5 text-[12px] text-foreground/60">{component.detail}</p>
                </div>
                <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${STATE_TONE[component.state]}`}>
                  {COMPONENT_STATE_LABELS[component.state]}
                </span>
              </div>
            ))}
          </div>

          <section className="mt-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl">Open incidents</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-foreground/65">
                  {sortedOpen.length
                    ? `${sortedOpen.length} open incident${sortedOpen.length === 1 ? "" : "s"}, newest updates first.`
                    : "No open incidents. The checks above are performed when this page loads."}
                </p>
              </div>
              <a
                href="/status/feed.xml"
                className="inline-flex h-9 items-center border border-foreground/20 px-4 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-foreground"
              >
                Atom feed
              </a>
            </div>

            <div className="mt-5 space-y-4">
              {sortedOpen.map((incident) => (
                <article key={incident.id} className="border border-foreground/12 px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-medium">{incident.title}</h3>
                      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/60">
                        {incident.component} ·{" "}
                        {IMPACT_META[isIncidentImpact(incident.impact) ? incident.impact : "minor"].label} ·{" "}
                        {isIncidentStatus(incident.status)
                          ? INCIDENT_STATUS_LABELS[incident.status]
                          : incident.status}{" "}
                        · started {shortDate(incident.startedAt)}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/60">
                      {timeAgo(incident.startedAt)}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-foreground/65">{incident.body}</p>
                  {incident.updates.length ? (
                    <div className="mt-4 space-y-3 border-l border-foreground/15 pl-4">
                      {incident.updates.map((update) => (
                        <div key={update.id}>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/60">
                            {isIncidentStatus(update.status) ? INCIDENT_STATUS_LABELS[update.status] : update.status} ·{" "}
                            {shortDate(update.createdAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-foreground/60">{update.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-display text-3xl">Incident history</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-foreground/65">
              Resolved incidents from the last 30 days. Each entry is the record the on-call engineer published at the time.
            </p>
            {history.length ? (
              <div className="mt-5 divide-y divide-foreground/10 border border-foreground/12">
                {history.map((incident) => (
                  <details key={incident.id} className="group px-5 py-4">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 list-none">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{incident.title}</span>
                        <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/60">
                          {incident.component} ·{" "}
                          {IMPACT_META[isIncidentImpact(incident.impact) ? incident.impact : "minor"].label} ·{" "}
                          {incident.updates.length} update{incident.updates.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#276a4e] dark:text-[#7fd1ab]">
                        Resolved {incident.resolvedAt ? shortDate(incident.resolvedAt) : "—"}
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3 border-l border-foreground/15 pl-4">
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/60">
                          Investigating · {shortDate(incident.startedAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-foreground/60">{incident.body}</p>
                      </div>
                      {incident.updates.map((update) => (
                        <div key={update.id}>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/60">
                            {isIncidentStatus(update.status) ? INCIDENT_STATUS_LABELS[update.status] : update.status} ·{" "}
                            {shortDate(update.createdAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-foreground/60">{update.body}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="mt-5 border border-foreground/12 px-5 py-6 text-[12px] leading-relaxed text-foreground/60">
                No resolved incidents in the last 30 days. This page does not synthesise uptime percentages; incidents are
                the historical record.
              </p>
            )}
          </section>

          <div className="mt-10 grid gap-6 border-t border-foreground/10 pt-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="text-[12px] leading-relaxed text-foreground/65">
                Something looks wrong? Email{" "}
                <a href="mailto:support@authab.dev" className="underline underline-offset-4">support@authab.dev</a> with the
                request id from the failing response. Security issues go to{" "}
                <a href="mailto:security@authab.dev" className="underline underline-offset-4">security@authab.dev</a>.
              </p>
            </div>
            <Link
              href="/trust"
              className="inline-flex h-10 items-center border border-foreground/20 px-5 text-[13px] hover:border-foreground"
            >
              Trust center
            </Link>
          </div>

          <p className="mt-8 text-[11px] text-foreground/60">
            This page is generated from the running control plane at request time. It reports Authab&apos;s own health, not
            your providers&apos; — check credential health in your vault for upstream status.
          </p>
        </div>
      </div>
      <FooterSection />
    </main>
  );
}

function loadOpenIncidents() {
  return db.incident.findMany({
    where: { resolvedAt: null },
    include: { updates: { orderBy: { createdAt: "asc" } } },
    orderBy: { startedAt: "desc" },
  });
}

function loadHistory() {
  return db.incident.findMany({
    where: { resolvedAt: { not: null, gte: new Date(Date.now() - 30 * 86_400_000) } },
    include: { updates: { orderBy: { createdAt: "asc" } } },
    orderBy: { resolvedAt: "desc" },
    take: 20,
  });
}
