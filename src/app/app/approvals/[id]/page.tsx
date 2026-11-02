import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { connector, actionFor } from "@/lib/connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { decideApprovalAction } from "@/app/app/actions";
import { PageHeader, Panel, StatusBadge, RiskBadge, Notice, relativeTime, formatDate } from "@/components/app/ui";
import { approvalUrlFor } from "@/lib/signed-links";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Approval" };

const ERROR_COPY: Record<string, string> = {
  permission: "Only owners, admins and approvers can decide requests.",
  production: "Your role cannot approve production changes.",
  closed: "This request was already decided or has expired.",
};

export default async function ApprovalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { id } = await params;
  const query = await searchParams;

  const approval = await db.approvalRequest.findFirst({
    where: { id, environmentId: ctx.environment.id },
    include: {
      agent: { select: { id: true, name: true, status: true, fingerprint: true } },
      credential: { select: { id: true, name: true, connectorSlug: true, maskedHint: true } },
      grant: true,
    },
  });
  if (!approval) notFound();

  const decider = approval.decidedBy ? await db.user.findUnique({ where: { id: approval.decidedBy }, select: { name: true, email: true } }) : null;
  const def = connector(approval.credential?.connectorSlug ?? "");
  const action = actionFor(approval.credential?.connectorSlug ?? "", approval.action);
  const redacted = (() => {
    try {
      return JSON.parse(approval.redactedJson || "{}") as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const payload = (() => {
    try {
      return JSON.parse(approval.payloadJson || "{}") as { resource?: string | null; requestId?: string };
    } catch {
      return {} as { resource?: string | null; requestId?: string };
    }
  })();
  const execution = (() => {
    try {
      return approval.executionResult ? (JSON.parse(approval.executionResult) as unknown) : null;
    } catch {
      return approval.executionResult;
    }
  })();

  const pending = approval.status === "pending" && approval.expiresAt > new Date();
  const canDecide = ctx.capabilities.approve && (!ctx.isProduction || ctx.capabilities.writeProduction);
  const grantActions = approval.grant ? (JSON.parse(approval.grant.actionsJson || "[]") as string[]) : [];

  return (
    <div>
      <PageHeader
        eyebrow={`Approvals · ${approval.status}`}
        title={action?.label ?? approval.action}
        description={approval.summary}
        actions={
          <Link href="/app/approvals" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Inbox
          </Link>
        }
      />

      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That decision could not be recorded."}</Notice> : null}
      {query.decided ? <Notice kind="ok">Decision recorded. The agent sees the outcome on its next poll.</Notice> : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <span
          className="flex size-8 items-center justify-center text-white"
          style={{ background: def?.color ?? "#333" }}
        >
          <ConnectorLogo slug={approval.credential?.connectorSlug ?? ""} mark={def?.mark} mono className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium">{def?.name ?? "Unknown service"}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
            {approval.credential?.name ?? "connection removed"}
          </p>
        </div>
        <span className="font-mono text-[10px] text-black/30 dark:text-muted-foreground">·</span>
        <StatusBadge status={approval.status} />
        <RiskBadge risk={approval.risk} />
        <span className="font-mono text-[10px] text-black/40 dark:text-muted-foreground">
          requested {relativeTime(approval.createdAt)}
        </span>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
          {pending ? `expires ${relativeTime(approval.expiresAt)}` : `expires ${formatDate(approval.expiresAt)}`}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Requested payload" hint="Secrets are redacted before storage" bodyClassName="p-0">
            <div className="border-b border-black/10 px-4 py-2.5 dark:border-border">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">
                {approval.action}
                {payload.resource ? ` · ${payload.resource}` : ""}
              </p>
            </div>
            <pre className="max-h-72 overflow-auto bg-[#0b0b0b] p-4 font-mono text-[11px] leading-relaxed text-[#e8e6e1]">
              {JSON.stringify(redacted, null, 2)}
            </pre>
            {def?.redactedFields.length ? (
              <p className="px-4 py-2.5 text-[10px] leading-relaxed text-black/45 dark:text-muted-foreground">
                Redacted fields for this connector: <span className="font-mono">{def.redactedFields.join(", ")}</span>. The proxy
                injects the real values at execution time only.
              </p>
            ) : null}
          </Panel>

          {execution ? (
            <Panel title="Execution result" hint="What the service returned" bodyClassName="p-0">
              <pre className="max-h-72 overflow-auto bg-[#0b0b0b] p-4 font-mono text-[11px] leading-relaxed text-[#e8e6e1]">
                {JSON.stringify(execution, null, 2)}
              </pre>
            </Panel>
          ) : null}

          {pending ? (
            <Panel title="Decide" hint="Approval executes the exact request" bodyClassName="p-4">
              {canDecide ? (
                <form action={decideApprovalAction} className="space-y-3">
                  <input type="hidden" name="approvalId" value={approval.id} />
                  <div>
                    <label htmlFor="note" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                      Note
                    </label>
                    <textarea
                      id="note"
                      name="note"
                      rows={2}
                      maxLength={500}
                      placeholder="Optional context for the audit trail"
                      className="mt-1 w-full resize-none border border-black/15 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
                    />
                  </div>
                  {approval.grant && approval.grant.approvalMode !== "allow" ? (
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
                      <input type="checkbox" name="approveAlways" className="mt-0.5 size-3.5 accent-black" />
                      Approve always — switch this grant to allow for future calls. Only do this for repeated, low-risk work.
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2 border-t border-black/10 pt-3 dark:border-border">
                    <button
                      name="decision"
                      value="approve"
                      className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black"
                    >
                      Approve and run
                    </button>
                    <button
                      name="decision"
                      value="deny"
                      className="border border-[#b3402f]/35 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8c3225] hover:bg-[#b3402f] hover:text-white"
                    >
                      Deny
                    </button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-black/40 dark:text-muted-foreground">
                    Approving runs the call immediately with the stored credential. Denying tells the agent why, if you leave a
                    note.
                  </p>
                </form>
              ) : (
                <p className="text-[12px] leading-relaxed text-black/55 dark:text-muted-foreground">
                  Your role can view this request but not decide it. Approvers, admins and owners can sign off.
                </p>
              )}
            </Panel>
          ) : (
            <Panel title="Decision" hint="Closed" bodyClassName="p-0">
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                <Row label="Outcome" value={approval.status} />
                <Row label="Decided by" value={decider ? `${decider.name} · ${decider.email}` : "—"} />
                <Row label="Decided" value={approval.decidedAt ? formatDate(approval.decidedAt) : "—"} />
                <Row label="Note" value={approval.decisionNote || "—"} />
              </dl>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Request" hint="Identifiers and routing" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/45 dark:text-muted-foreground">Agent</dt>
                <dd className="text-right">
                  <Link href={`/app/agents/${approval.agent.id}`} className="underline-offset-2 hover:underline">
                    {approval.agent.name}
                  </Link>
                  <span className="ml-1.5 inline-block align-middle">
                    <StatusBadge status={approval.agent.status} />
                  </span>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/45 dark:text-muted-foreground">Connection</dt>
                <dd className="text-right">
                  {approval.credential ? (
                    <Link href={`/app/vault/${approval.credential.id}`} className="underline-offset-2 hover:underline">
                      {approval.credential.name}
                    </Link>
                  ) : (
                    "Removed"
                  )}
                </dd>
              </div>
              <Row label="Action" value={approval.action} mono />
              <Row label="Resource" value={payload.resource ?? "—"} mono />
              <Row label="Risk" value={approval.risk} />
              <Row label="Request ID" value={payload.requestId ?? approval.requestId} mono />
              <Row label="Fingerprint" value={`${approval.agent.fingerprint.slice(0, 16)}…`} mono />
            </dl>
          </Panel>

          {approval.grant ? (
            <Panel title="Grant behind this call" hint="Why policy let it reach a human" bodyClassName="p-4">
              <div className="flex flex-wrap gap-1">
                {grantActions.map((granted) => (
                  <span key={granted} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] text-black/55 dark:border-border dark:text-muted-foreground">
                    {granted}
                  </span>
                ))}
              </div>
              <p className="mt-2 font-mono text-[9px] leading-relaxed text-black/40 dark:text-muted-foreground">
                resource {approval.grant.resourcePattern} · {approval.grant.approvalMode ?? "policy default"}
              </p>
              <Link href={`/app/permissions/${approval.agent.id}`} className="mt-3 inline-block font-mono text-[9px] uppercase tracking-[0.12em] underline-offset-2 hover:underline">
                Edit this grant
              </Link>
            </Panel>
          ) : null}

          {pending ? (
            <Panel title="Signed link" hint="For email approvals" bodyClassName="p-4">
              <p className="text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
                The same decision can be made from a signed link delivered by email. The link is scoped to this single
                request and expires with it.
              </p>
              <p className="mt-2 break-all border border-black/10 bg-[#faf9f6] p-2 font-mono text-[9px] text-black/55 dark:border-border dark:bg-background dark:text-muted-foreground">
                {approvalUrlFor(approval.token)}
              </p>
            </Panel>
          ) : null}

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">Audit</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
              Request, decision and execution are three chained events. Changing any of them breaks verification for the whole
              environment.
            </p>
            <Link href={`/app/activity?agentId=${approval.agent.id}`} className="mt-2 inline-block font-mono text-[9px] uppercase tracking-[0.12em] underline-offset-2 hover:underline">
              View the agent&apos;s trail
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-2.5">
      <dt className="text-black/45 dark:text-muted-foreground">{label}</dt>
      <dd className={`text-right capitalize ${mono ? "break-all font-mono text-[10px] normal-case" : ""}`}>{value}</dd>
    </div>
  );
}
