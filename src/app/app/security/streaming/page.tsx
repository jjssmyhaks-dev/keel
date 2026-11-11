import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { planFor } from "@/lib/plans";
import {
  createAuditSinkAction,
  deleteAuditSinkAction,
  deliverAuditSinksAction,
  testAuditSinkAction,
  toggleAuditSinkAction,
} from "./actions";
import { ConfirmButton } from "@/components/app/confirm-button";
import { CopyButton } from "@/components/app/copy-button";
import { Notice, PageHeader, Panel, Stat, StatusBadge, formatDate, relativeTime } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Audit streaming" };

const ERRORS: Record<string, string> = {
  permission: "Only owners and admins can manage audit destinations.",
  missing: "That destination no longer exists.",
  fields: "A destination needs a name, URL and signing secret.",
  type: "Choose webhook or Splunk HEC.",
  url: "That URL is not allowed. Use a public HTTPS endpoint.",
};

const SAMPLE = `{
  "source": "authab",
  "organizationId": "org_…",
  "event": {
    "id": "cm…",
    "seq": 142,
    "action": "proxy.call",
    "outcome": "allowed",
    "prevHash": "…",
    "hash": "…"
  }
}`;

const labelClass =
  "font-mono text-[9px] uppercase tracking-[0.16em] text-black/65 dark:text-muted-foreground";
const inputClass =
  "mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background";

export default async function AuditStreamingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const canManage = ctx.capabilities.manageSecurity;
  const retentionDays = planFor(ctx.org.plan).limits.retentionDays;

  const sinks = await db.auditSink.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { createdAt: "desc" },
  });
  const sinkIds = sinks.map((sink) => sink.id);
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [recent, delivered24h, failed24h, pending] = await Promise.all([
    sinkIds.length
      ? db.auditSinkDelivery.findMany({
          where: { sinkId: { in: sinkIds } },
          orderBy: { createdAt: "desc" },
          take: 80,
        })
      : Promise.resolve([]),
    sinkIds.length
      ? db.auditSinkDelivery.count({ where: { sinkId: { in: sinkIds }, deliveredAt: { gte: since } } })
      : Promise.resolve(0),
    sinkIds.length
      ? db.auditSinkDelivery.count({ where: { sinkId: { in: sinkIds }, error: { not: null }, createdAt: { gte: since } } })
      : Promise.resolve(0),
    sinkIds.length
      ? db.auditSinkDelivery.count({ where: { sinkId: { in: sinkIds }, deliveredAt: null } })
      : Promise.resolve(0),
  ]);
  const lastDelivery = sinks.reduce<Date | null>((latest, sink) => {
    if (!sink.lastDeliveryAt) return latest;
    return !latest || sink.lastDeliveryAt > latest ? sink.lastDeliveryAt : latest;
  }, null);

  return (
    <div>
      <PageHeader
        eyebrow="Security · audit streaming"
        title="Every decision leaves the building."
        description="Stream the hash-chained audit log to your SIEM over signed webhooks or Splunk HEC. Delivery is retried with backoff, and the underlying audit table is append-only at the database level."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/security"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Security settings
            </Link>
            <Link
              href="/app/activity"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Activity log
            </Link>
          </div>
        }
      />

      {query.error ? <Notice kind="error">{ERRORS[query.error] ?? "That change could not be saved."}</Notice> : null}
      {query.created ? <Notice kind="ok">Destination added. Send a test event before relying on it.</Notice> : null}
      {query.saved ? <Notice kind="ok">Streaming settings saved.</Notice> : null}
      {query.deleted ? <Notice kind="ok">Destination removed. Undelivered events stay in the audit log.</Notice> : null}
      {query.tested === "ok" ? <Notice kind="ok">Test event delivered successfully.</Notice> : null}
      {query.tested === "failed" ? <Notice kind="error">The test delivery failed. Check the endpoint URL and credentials.</Notice> : null}
      {query.delivered ? (
        <Notice kind="ok">
          Delivery sweep complete: {query.delivered} delivered, {query.failed ?? 0} failed and queued for retry.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Destinations" value={sinks.length} detail={`${sinks.filter((s) => s.enabled).length} enabled`} accent />
        <Stat label="Delivered · 24h" value={delivered24h} detail="Signed audit events" />
        <Stat label="Failures · 24h" value={failed24h} detail={`${pending} queued`} />
        <Stat label="Last delivery" value={lastDelivery ? relativeTime(lastDelivery) : "None"} detail="Across all destinations" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Destinations" hint="Signed delivery, retried with backoff" bodyClassName="p-0">
            {sinks.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {sinks.map((sink) => {
                  const deliveries = recent.filter((delivery) => delivery.sinkId === sink.id).slice(0, 5);
                  return (
                    <div key={sink.id} className="p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <StatusBadge status={sink.enabled ? "active" : "paused"} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium">{sink.name}</p>
                          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                            {sink.type === "splunk" ? "Splunk HEC" : "Signed webhook"} ·{" "}
                            {sink.failureCount > 0 ? `${sink.failureCount} consecutive failures · ` : ""}
                            {sink.lastDeliveryAt ? `last delivery ${relativeTime(sink.lastDeliveryAt)}` : "no deliveries yet"}
                          </p>
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                          {formatDate(sink.createdAt)}
                        </span>
                      </div>

                      <p className="mt-2 break-all font-mono text-[10px] text-black/60 dark:text-muted-foreground">{sink.url}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {canManage ? (
                          <>
                            <form action={testAuditSinkAction}>
                              <input type="hidden" name="sinkId" value={sink.id} />
                              <button className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40">
                                Send test
                              </button>
                            </form>
                            <form action={toggleAuditSinkAction}>
                              <input type="hidden" name="sinkId" value={sink.id} />
                              <button
                                name="toggle"
                                value={sink.enabled ? "disable" : "enable"}
                                className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40"
                              >
                                {sink.enabled ? "Pause" : "Resume"}
                              </button>
                            </form>
                            <form action={deleteAuditSinkAction}>
                              <input type="hidden" name="sinkId" value={sink.id} />
                              <ConfirmButton
                                message={`Remove ${sink.name}? Undelivered events remain in the audit log but stop streaming here.`}
                                className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#b3402f] hover:border-[#b3402f] dark:border-white/40"
                              >
                                Remove
                              </ConfirmButton>
                            </form>
                          </>
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                            Owners and admins manage destinations
                          </span>
                        )}
                      </div>

                      {deliveries.length ? (
                        <div className="mt-3 border-t border-black/10 pt-2 dark:border-border">
                          {deliveries.map((delivery) => (
                            <div key={delivery.id} className="flex items-center justify-between gap-2 py-1 font-mono text-[9px]">
                              <span className="text-black/60 dark:text-muted-foreground">
                                {delivery.environmentId ? `seq ${delivery.seq}` : "test"} · {relativeTime(delivery.createdAt)}
                              </span>
                              <span
                                className={
                                  delivery.deliveredAt
                                    ? "text-[#276a4e] dark:text-[#7fd1ab]"
                                    : delivery.error
                                      ? "text-[#b3402f]"
                                      : "text-[#8a5600] dark:text-[#eca8d6]"
                                }
                              >
                                {delivery.deliveredAt
                                  ? `delivered${delivery.statusCode ? ` · ${delivery.statusCode}` : ""}`
                                  : delivery.error
                                    ? `failed · attempt ${delivery.attempt}`
                                    : "queued"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8">
                <p className="text-[13px] font-medium">No destinations yet.</p>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Add a webhook receiver or a Splunk HEC endpoint. Every audit event in this organization then streams with
                  its sequence number, previous hash and current hash so your SIEM can verify the chain independently.
                </p>
                <pre className="mt-3 overflow-x-auto border border-black/10 bg-[#0b0b0b] p-3 font-mono text-[10px] leading-relaxed text-[#e8e6e1] dark:border-border">
                  {SAMPLE}
                </pre>
              </div>
            )}
          </Panel>

          {canManage ? (
            <Panel title="Add a destination" hint="Validated before saving" bodyClassName="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <form action={deliverAuditSinksAction}>
                  <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                    Run delivery sweep
                  </button>
                </form>
                <p className="text-[10px] text-black/60 dark:text-muted-foreground">
                  The cron sweep runs the same job automatically.
                </p>
              </div>

              <form action={createAuditSinkAction} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Display name</label>
                    <input name="name" required maxLength={60} placeholder="Splunk production" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Destination type</label>
                    <select name="type" defaultValue="webhook" className={inputClass}>
                      <option value="webhook">Webhook (HMAC-SHA256)</option>
                      <option value="splunk">Splunk HEC</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Endpoint URL</label>
                  <input name="url" required placeholder="https://siem.acme.com/ingest/authab" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Signing secret / HEC token</label>
                  <input name="secret" type="password" required autoComplete="off" className={inputClass} />
                  <p className="mt-1 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                    Encrypted with the workspace envelope key. Webhooks sign <span className="font-mono">t=…,v1=HMAC-SHA256(secret, timestamp.body)</span>{" "}
                    in the <span className="font-mono">x-authab-signature</span> header. Splunk uses{" "}
                    <span className="font-mono">Authorization: Splunk &lt;token&gt;</span>.
                  </p>
                </div>
                <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                  Add destination
                </button>
              </form>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel title="Immutable by construction" hint="WORM retention" bodyClassName="p-4">
            <ul className="space-y-2 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
              <li>A database trigger rejects every UPDATE, DELETE and TRUNCATE on the audit table unless a maintenance or restore job explicitly opts in.</li>
              <li>Retention pruning is the only maintenance path, and it runs in a transaction that explicitly opts in.</li>
              <li>Events are chained with SHA-256; the hash and previous hash travel with each streamed event.</li>
              <li>
                {retentionDays < 0
                  ? "This plan keeps audit events indefinitely."
                  : `This plan retains audit events for ${retentionDays} days.`}{" "}
                Export JSONL or CSV before the window closes if you need a longer archive.
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-black/10 pt-3 dark:border-border">
              <Link
                href="/app/activity"
                className="border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40"
              >
                Verify chain
              </Link>
              <CopyButton value="https://docs.authab.dev/security/audit-streaming" label="Docs" />
            </div>
          </Panel>

          <Panel title="What gets streamed" hint="One event per audit row" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
              Every proxy decision, approval, credential change, sign-in, SSO/SCIM mutation and settings change. Human
              actions and agent actions share the same chain, with the actor type recorded. Delivery is at-least-once,
              ordered per environment and retried up to eight times with exponential backoff.
            </p>
            <p className="mt-3 border-t border-black/10 pt-3 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground dark:border-border">
              SIEM receiver checklist: respond 2xx within 10 seconds, verify the HMAC using the shared secret, dedupe on
              <span className="font-mono"> x-authab-delivery</span>, and keep events with the same environment ordered by
              <span className="font-mono"> event.seq</span>.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
