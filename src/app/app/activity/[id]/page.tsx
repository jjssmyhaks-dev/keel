import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { actionLabel, canonical } from "@/lib/audit";
import { resolveConnector } from "@/lib/custom-connectors";
import { verifyAuditAction } from "@/app/app/actions";
import { PageHeader, Panel, StatusBadge, RiskBadge, Notice, relativeTime, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Call detail" };

const GENESIS = "0".repeat(64);
const CALL_ACTIONS = new Set(["proxy.call", "sandbox.call", "credential.checked"]);

type Trust = {
  egress?: boolean;
  request?: { method?: string | null; target?: string | null };
  injection?: { location?: string; name?: string | null; scheme?: string | null; source?: string };
  injectedHeaders?: string[];
  injectedParams?: string[];
  injectedBodyFields?: string[];
  redactions?: string[];
  responseRedactions?: number;
  responseStatus?: number | null;
  latencyMs?: number;
  truncated?: boolean;
  providerError?: string;
  traceId?: string;
  billable?: boolean;
};

type Decision = { effect?: string; risk?: string; source?: string; reason?: string; grantId?: string | null };

function parseJson(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-black/60 dark:text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-words text-right ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd>
    </div>
  );
}

export default async function ActivityEventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  const { id } = await params;

  const event = await db.auditEvent.findFirst({ where: { id, environmentId: ctx.environment.id } });
  if (!event) notFound();

  const payload = parseJson(event.payloadSummary);
  const trust = objectValue(payload.trust) as Trust | null;
  const decision = (objectValue(payload.decision) ?? {
    effect: typeof payload.risk === "string" ? "deny" : undefined,
    risk: typeof payload.risk === "string" ? payload.risk : undefined,
    source: typeof payload.source === "string" ? payload.source : undefined,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  }) as Decision;
  const risk = typeof payload.risk === "string" ? payload.risk : typeof decision.risk === "string" ? decision.risk : null;
  const input = objectValue(payload.input);
  const isCall = CALL_ACTIONS.has(event.action);
  const credentialId = typeof payload.credentialId === "string" ? payload.credentialId : null;
  const approvalId =
    typeof payload.approvalId === "string"
      ? payload.approvalId
      : event.resourceType === "approval"
        ? event.resourceId
        : null;

  const [credential, approval, related, previous] = await Promise.all([
    credentialId
      ? db.credential.findFirst({
          where: { id: credentialId, environmentId: ctx.environment.id, endUserId: null },
          select: { id: true, name: true, connectorSlug: true, maskedHint: true, status: true },
        })
      : Promise.resolve(null),
    approvalId
      ? db.approvalRequest.findFirst({
          where: { id: approvalId, environmentId: ctx.environment.id },
          select: { id: true, status: true, decisionNote: true, decidedBy: true, decidedAt: true },
        })
      : Promise.resolve(null),
    db.auditEvent.findMany({
      where: { environmentId: ctx.environment.id, requestId: event.requestId },
      orderBy: { seq: "asc" },
      take: 25,
      select: { id: true, seq: true, action: true, outcome: true, timestamp: true, payloadSummary: true },
    }),
    event.seq > 1
      ? db.auditEvent.findFirst({ where: { environmentId: ctx.environment.id, seq: event.seq - 1 }, select: { hash: true } })
      : Promise.resolve(null),
  ]);

  const def = credential ? await resolveConnector(credential.connectorSlug, ctx.environment.id) : null;

  const chain = (() => {
    try {
      const parsed = JSON.parse(event.chainJson || "[]") as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const expectedHash = createHash("sha256")
    .update(
      `${event.prevHash}:${canonical({
        seq: event.seq,
        timestamp: event.timestamp.toISOString(),
        actorType: event.actorType,
        actorId: event.actorId,
        actorName: event.actorName,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        outcome: event.outcome,
        requestId: event.requestId,
        ip: event.ip,
        agentId: event.agentId,
        payloadSummary: payload,
        chain,
      })}`,
    )
    .digest("hex");
  const hashOk = expectedHash === event.hash;
  const prevOk = event.seq === 1 ? event.prevHash === GENESIS : previous?.hash === event.prevHash;

  const redactions = stringList(trust?.redactions);
  const injectedHeaders = stringList(trust?.injectedHeaders);
  const injectedParams = stringList(trust?.injectedParams);
  const injectedBodyFields = stringList(trust?.injectedBodyFields);
  const title = typeof payload.action === "string" ? payload.action : actionLabel(event.action);

  return (
    <div>
      <PageHeader
        eyebrow={`Activity · event #${event.seq}`}
        title={title}
        description={
          isCall
            ? event.outcome === "denied"
              ? "Denied before execution. This record shows the decision and the exact chain link, and states that nothing was injected."
              : "What the proxy injected, what it redacted, and the hash-chain link for this single call."
            : "The complete audit record for this event and its place in the environment's hash chain."
        }
        actions={
          <>
            <form action={verifyAuditAction}>
              <input type="hidden" name="back" value={`/app/activity/${event.id}`} />
              <button className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
                Verify chain
              </button>
            </form>
            <Link
              href={`/app/activity?action=${event.action}`}
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Back to activity
            </Link>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
          {actionLabel(event.action)}
        </span>
        <StatusBadge status={event.outcome} />
        {risk ? <RiskBadge risk={risk} /> : null}
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">·</span>
        <span className="break-all font-mono text-[10px] text-black/60 dark:text-muted-foreground">{event.requestId}</span>
        <span className="ml-auto font-mono text-[10px] text-black/60 dark:text-muted-foreground">
          {relativeTime(event.timestamp)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-6">
          {isCall ? (
            <Panel title="What the proxy injected" hint="Values are never written down" bodyClassName="p-0">
              {trust?.injection ? (
                <>
                  <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                    <Fact label="Credential source" value={trust.injection.source ?? "—"} />
                    <Fact
                      label="Injected at"
                      value={
                        trust.injection.location === "none"
                          ? "Nothing was injected"
                          : trust.injection.location === "query"
                            ? "URL query parameter"
                            : "Request header"
                      }
                    />
                    {trust.injection.name ? <Fact label="Header / parameter" value={trust.injection.name} mono /> : null}
                    {trust.injection.scheme ? <Fact label="Scheme" value={trust.injection.scheme} mono /> : null}
                    {injectedHeaders.length ? <Fact label="Headers set" value={injectedHeaders.join(", ")} mono /> : null}
                    {injectedParams.length ? <Fact label="Query params set" value={injectedParams.join(", ")} mono /> : null}
                    {injectedBodyFields.length ? (
                      <Fact label="Body fields set" value={injectedBodyFields.join(", ")} mono />
                    ) : null}
                    <Fact label="Provider egress" value={trust.egress ? "HTTPS, one request" : "None — in-process sandbox"} />
                  </dl>
                  <p className="border-t border-black/10 px-4 py-3 text-[11px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
                    The secret value, the full Authorization header and the request body are held in memory for the single
                    upstream request and are never stored here. This record names the injection point, not its contents.
                  </p>
                </>
              ) : (
                <p className="px-4 py-5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  This event predates the trust record, or execution stopped before any credential was read. Nothing is
                  claimed about injection for this call.
                </p>
              )}
            </Panel>
          ) : null}

          {isCall ? (
            <Panel title="What was redacted" hint="Stored input and scanned response" bodyClassName="p-0">
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                <Fact
                  label="Input fields"
                  value={
                    redactions.length ? (
                      <span className="font-mono text-[10px]">{redactions.join(", ")}</span>
                    ) : (
                      "No request field matched the redaction rules"
                    )
                  }
                />
                <Fact
                  label="Response scan"
                  value={
                    trust?.egress === false
                      ? "No provider response — the sandbox envelope is generated in-process and not stored"
                      : trust && trust.responseStatus === null
                        ? "No response body was returned"
                        : trust
                          ? trust.responseRedactions
                            ? `${trust.responseRedactions} occurrence${trust.responseRedactions === 1 ? "" : "s"} of the credential replaced with [redacted] before the agent received the response`
                            : "The credential value did not appear in the response"
                          : "Not recorded"
                  }
                />
              </dl>
              {input ? (
                <div className="border-t border-black/10 px-4 py-3 dark:border-border">
                  <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Redacted input stored in the chain
                  </p>
                  <pre className="mt-1 max-h-48 overflow-auto border border-black/10 bg-[#0b0b0b] p-2.5 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">
                    {JSON.stringify(input, null, 2)}
                  </pre>
                </div>
              ) : null}
              <p className="border-t border-black/10 px-4 py-3 text-[11px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
                Provider response bodies are never stored in the audit chain. The agent receives the redacted response
                directly; this record keeps the status, timing and redaction count.
              </p>
            </Panel>
          ) : null}

          {trust ? (
            <Panel title="Execution" hint="Status and timing, never the body" bodyClassName="p-0">
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                <Fact
                  label="Target"
                  value={
                    trust.request?.target ? (
                      <span className="font-mono text-[10px]">
                        {(trust.request.method ?? "—") + " " + trust.request.target}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Fact label="Upstream status" value={trust.responseStatus ?? (trust.egress === false ? "Synthetic 200" : "—")} mono />
                <Fact label="Latency" value={`${trust.latencyMs ?? 0} ms`} mono />
                <Fact label="Truncated" value={trust.truncated ? "Yes — capped at 2 MB" : "No"} />
                <Fact label="Billable" value={trust.billable === false ? "No — sandbox and health checks are excluded" : "One proxy call"} />
                {trust.traceId ? <Fact label="Trace ID" value={trust.traceId} mono /> : null}
                {trust.providerError ? <Fact label="Provider error" value={trust.providerError} mono /> : null}
              </dl>
            </Panel>
          ) : null}

          {decision.effect || decision.reason || decision.source ? (
            <Panel title="Decision" hint="Why the call reached this point" bodyClassName="p-0">
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                <Fact label="Effect" value={decision.effect ?? (event.outcome === "denied" ? "deny" : "allow")} />
                <Fact label="Risk" value={risk ?? "—"} />
                <Fact label="Source" value={decision.source ?? "—"} mono />
                {decision.grantId ? <Fact label="Grant" value={decision.grantId} mono /> : null}
                <Fact label="Reason" value={decision.reason ?? "—"} />
              </dl>
            </Panel>
          ) : null}

          {event.action === "approval.requested" ? (
            <Notice kind="info">
              This request has not executed yet. Approving it runs the stored call and writes a separate execution event
              with the same request id, so this page gains its trust record at that point.
            </Notice>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Chain integrity" hint="Recomputed in this request" bodyClassName="p-0">
            <div className="px-4 pt-4">
              <Notice kind={hashOk && prevOk ? "ok" : "error"}>
                {hashOk && prevOk
                  ? "This event's hash recomputes exactly and its prev-hash matches the previous event."
                  : "This event does not match the chain. Verify the full chain and treat the log as suspect."}
              </Notice>
            </div>
            <dl className="mt-3 divide-y divide-black/10 text-[12px] dark:divide-border">
              <Fact label="Sequence" value={`#${event.seq}`} mono />
              <Fact label="Timestamp" value={formatDate(event.timestamp)} />
              <Fact label="Actor" value={`${event.actorName} (${event.actorType})`} />
              <Fact label="Request ID" value={event.requestId} mono />
              <Fact label="IP" value={event.ip ?? "—"} mono />
              <Fact
                label="Previous hash"
                value={<span className="break-all">{event.prevHash.slice(0, 24)}…</span>}
                mono
              />
              <Fact label="Stored hash" value={<span className="break-all">{event.hash.slice(0, 24)}…</span>} mono />
              <Fact
                label="Recomputed"
                value={<span className="break-all">{expectedHash.slice(0, 24)}…</span>}
                mono
              />
              <Fact
                label="Links to previous"
                value={prevOk ? (event.seq === 1 ? "Genesis" : "Matches") : "Mismatch"}
              />
            </dl>
          </Panel>

          <Panel title="Context" hint="What this event touches" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <Fact
                label="Connector"
                value={
                  <Link href="/app/connectors" className="underline">
                    {def?.name ?? event.resourceId ?? "—"}
                  </Link>
                }
              />
              <Fact
                label="Connection"
                value={
                  credential ? (
                    <Link href={`/app/vault/${credential.id}`} className="underline">
                      {credential.name} · {credential.maskedHint || "no hint"}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <Fact
                label="Agent"
                value={
                  event.agentId ? (
                    <Link href={`/app/agents/${event.agentId}`} className="underline">
                      {event.actorName}
                    </Link>
                  ) : (
                    event.actorName
                  )
                }
              />
              <Fact
                label="Approval"
                value={
                  approval ? (
                    <Link href={`/app/approvals/${approval.id}`} className="underline">
                      {approval.status}
                      {approval.decidedBy ? ` by ${approval.decidedBy}` : ""}
                    </Link>
                  ) : (
                    "None"
                  )
                }
              />
              <Fact label="Resource" value={`${event.resourceType}${event.resourceId ? ` · ${event.resourceId}` : ""}`} mono />
            </dl>
          </Panel>

          <Panel title="Related events" hint="Same request id" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {related.map((entry) => {
                const summary = parseJson(entry.payloadSummary);
                return (
                  <Link
                    key={entry.id}
                    href={`/app/activity/${entry.id}`}
                    className={`flex flex-wrap items-center gap-2 px-4 py-2.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
                      entry.id === event.id ? "bg-black/[0.03] dark:bg-white/[0.04]" : ""
                    }`}
                  >
                    <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">#{entry.seq}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {actionLabel(entry.action)}
                      {typeof summary.action === "string" ? (
                        <span className="ml-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          {summary.action}
                        </span>
                      ) : null}
                    </span>
                    <StatusBadge status={entry.outcome} />
                    <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                      {entry.id === event.id ? "this event" : relativeTime(entry.timestamp)}
                    </span>
                  </Link>
                );
              })}
            </div>
            {related.length <= 1 ? (
              <p className="border-t border-black/10 px-4 py-3 text-[11px] text-black/60 dark:border-border dark:text-muted-foreground">
                No other event shares this request id.
              </p>
            ) : null}
          </Panel>

          <Panel title="Raw envelope" hint="Exactly what was hashed" bodyClassName="p-4">
            <pre className="max-h-72 overflow-auto border border-black/10 bg-[#0b0b0b] p-2.5 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </Panel>
        </div>
      </div>
    </div>
  );
}
