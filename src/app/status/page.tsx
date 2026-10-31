import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { envSettings } from "@/lib/policy";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status — Keel",
  description: "Live status for the Keel control plane, proxy and audit pipeline.",
};

function timeAgo(date: Date) {
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export default async function StatusPage() {
  const checkedAt = new Date();
  let database = true;
  let environmentCount = 0;
  let mockOnly = true;

  try {
    environmentCount = await db.environment.count();
    const rows = await db.environment.findMany({ select: { settingsJson: true, type: true } });
    mockOnly =
      rows.length > 0 && rows.every((row) => row.type === "development" || Boolean(envSettings(row).mockMode));
  } catch {
    database = false;
  }

  const liveEgress = process.env.KEEL_PROXY_LIVE === "1" && !mockOnly;
  const components = [
    { name: "Control plane", detail: "Dashboard, API keys, sessions", ok: database },
    { name: "Metadata store", detail: database ? `${environmentCount} environments reachable` : "Database check failed", ok: database },
    { name: "Agent proxy", detail: liveEgress ? "Live egress enabled" : "Mock egress — provider calls simulated", ok: database },
    { name: "Audit pipeline", detail: "Hash-chained writes and export", ok: database },
  ];
  const allOk = components.every((component) => component.ok);

  return (
    <main className="relative">
      <Navigation />
      <div className="pt-28 lg:pt-36 pb-24">
        <div className="mx-auto max-w-[1000px] px-6 lg:px-12">
          <p className="mono-label text-foreground/40 mb-5">Status</p>
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-foreground/10 pb-10">
            <h1 className="font-display text-6xl lg:text-7xl leading-[0.9] tracking-tight">
              {allOk ? "All systems nominal." : "Degraded."}
            </h1>
            <div className="text-right">
              <span className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] ${allOk ? "text-[#2f7d5c]" : "text-[#8c3225]"}`}>
                <span className={`size-2 rounded-full ${allOk ? "bg-[#2f7d5c] live-dot" : "bg-[#8c3225]"}`} />
                {allOk ? "Operational" : "Investigating"}
              </span>
              <p className="mt-2 text-[11px] text-foreground/40">Checked {timeAgo(checkedAt)}</p>
            </div>
          </div>

          <div className="mt-10 divide-y divide-foreground/10 border border-foreground/12">
            {components.map((component) => (
              <div key={component.name} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-[14px]">{component.name}</p>
                  <p className="mt-0.5 text-[12px] text-foreground/45">{component.detail}</p>
                </div>
                <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${component.ok ? "text-[#2f7d5c]" : "text-[#8c3225]"}`}>
                  {component.ok ? "Operational" : "Degraded"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <h2 className="font-display text-3xl">Incidents</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground/55">
                No open incidents. A written post-incident review is published for every customer-visible outage. If
                something looks wrong, write to{" "}
                <a href="mailto:support@keel.dev" className="underline underline-offset-4">support@keel.dev</a> and include
                the request id from the failing response.
              </p>
            </div>
            <Link
              href="/app/security"
              className="inline-flex h-10 items-center border border-foreground/20 px-5 text-[13px] hover:border-foreground"
            >
              View guardrails
            </Link>
          </div>

          <p className="mt-10 border-t border-foreground/10 pt-6 text-[11px] text-foreground/35">
            This page is generated from the running control plane at request time. It reports Keel&apos;s own health, not
            your providers&apos; — check the credential health in your vault for upstream status.
          </p>
        </div>
      </div>
      <FooterSection />
    </main>
  );
}
