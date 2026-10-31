import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/logo";
import { getSession, can } from "@/lib/session";
import { connector, RISK_META } from "@/lib/connectors";
import { decideApprovalAction } from "./actions";

export const metadata: Metadata = { title: "Approval request" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting a decision",
  approved: "Approved and executed",
  denied: "Denied",
  expired: "Expired",
  failed: "Approved — execution failed",
};

export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; decided?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const approval = await db.approvalRequest.findUnique({
    where: { token },
    include: {
      agent: true,
      credential: true,
      environment: { include: { project: { include: { org: true } } } },
      grant: true,
    },
  });

  if (!approval) {
    return (
      <Shell>
        <h1 className="font-display text-5xl tracking-tight">This link is not valid.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          The approval was withdrawn, already decided, or the link was truncated. Open the approvals inbox to see what
          is waiting.
        </p>
        <Link
          href="/sign-in"
          className="mt-8 inline-flex border border-black bg-black px-5 py-3 text-xs font-mono uppercase tracking-widest text-white"
        >
          Sign in to Keel
        </Link>
      </Shell>
    );
  }

  const session = await getSession();
  const membership = session
    ? await db.membership.findUnique({
        where: { orgId_userId: { orgId: approval.environment.project.orgId, userId: session.user.id } },
      })
    : null;
  const canDecide = Boolean(membership && can(membership.role, "approve"));
  const pending = approval.status === "pending" && approval.expiresAt > new Date();
  const connectorDef = connector(approval.credential?.connectorSlug ?? "");
  const risk = RISK_META[(approval.risk as keyof typeof RISK_META) ?? "write"] ?? RISK_META.write;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(approval.redactedJson || "{}");
  } catch {}

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-3">
        <span className="border border-black/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
          {approval.environment.type} · {approval.environment.project.name}
        </span>
        <span className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: risk.color, border: `1px solid ${risk.color}55` }}>
          {risk.label} risk
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {STATUS_LABEL[approval.status] ?? approval.status}
        </span>
      </div>

      <h1 className="mt-6 font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-[0.95] tracking-tight">
        {pending ? "A human decision is needed." : "Decision recorded."}
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        {approval.summary}
      </p>

      {query.error ? (
        <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
          {query.error === "permission"
            ? "Your role cannot approve requests in this organization. Ask an Owner, Admin or Approver to decide."
            : query.error === "closed"
              ? "This request is no longer pending. Refresh to see its final state."
              : "This request could not be found."}
        </p>
      ) : null}

      <div className="mt-10 grid gap-px border border-black/15 bg-black/15 md:grid-cols-[1fr_1.1fr]">
        <div className="bg-[var(--paper)] p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Request</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Agent" value={approval.agent.name} />
            <Row label="Action" value={approval.action} mono />
            <Row label="Connection" value={`${connectorDef?.name ?? approval.credential?.connectorSlug ?? "—"} · ${approval.credential?.name ?? "—"}`} />
            <Row label="Requested" value={approval.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
            <Row label="Expires" value={approval.expiresAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
            <Row label="Request ID" value={approval.requestId} mono />
          </dl>
        </div>
        <div className="bg-white p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Payload · redacted</p>
          <pre className="mt-4 overflow-x-auto border border-black/10 bg-[#0b0b0b] p-4 text-[12px] leading-relaxed text-[#e8e6e1]">
            {JSON.stringify(payload, null, 2)}
          </pre>
          {approval.grant ? (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Covered by a grant scoped to <span className="font-mono">{approval.grant.resourcePattern}</span>.{" "}
              {approval.grant.purpose ?? "No purpose recorded."}
            </p>
          ) : null}
        </div>
      </div>

      {pending ? (
        canDecide ? (
          <form action={decideApprovalAction} className="mt-8 border border-black/15 bg-white p-6">
            <input type="hidden" name="token" value={approval.token} />
            <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground" htmlFor="note">
              Note to the agent owner (optional)
            </label>
            <textarea
              id="note"
              name="note"
              rows={3}
              maxLength={500}
              placeholder="Why this is approved or denied…"
              className="mt-2 w-full resize-none border border-black/15 bg-[var(--paper)] px-3 py-2 text-sm outline-none focus:border-black"
            />
            <label className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="approveAlways" className="size-3.5 accent-black" />
              Approve this action automatically for this grant from now on
            </label>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="submit"
                name="decision"
                value="approve"
                className="border border-black bg-black px-6 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
              >
                Approve &amp; execute
              </button>
              <button
                type="submit"
                name="decision"
                value="deny"
                className="border border-black/25 px-6 py-3 text-xs font-mono uppercase tracking-[0.18em] transition-colors hover:border-black"
              >
                Deny
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Deciding as {session?.user.name} ({membership?.role}). The decision, note and identity are written to the
              tamper-evident audit log.
            </p>
          </form>
        ) : (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-black/15 bg-white p-6">
            <p className="max-w-md text-sm text-muted-foreground">
              {session
                ? "Your role is read-only for approvals. Ask an Owner, Admin or Approver in this organization to decide."
                : "Sign in with an Owner, Admin or Approver account to approve or deny this request."}
            </p>
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/approve/${approval.token}`)}`}
              className="border border-black bg-black px-5 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white"
            >
              Sign in to decide
            </Link>
          </div>
        )
      ) : (
        <div className="mt-8 border border-black/15 bg-white p-6">
          <p className="font-display text-3xl tracking-tight">{STATUS_LABEL[approval.status] ?? approval.status}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {approval.decidedAt
              ? `Decided ${approval.decidedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
              : "No decision was recorded."}
            {approval.decisionNote ? ` · “${approval.decisionNote}”` : ""}
          </p>
          {approval.executionResult ? (
            <pre className="mt-4 max-h-64 overflow-auto border border-black/10 bg-[#0b0b0b] p-4 text-[12px] leading-relaxed text-[#e8e6e1]">
              {JSON.stringify(JSON.parse(approval.executionResult), null, 2)}
            </pre>
          ) : null}
          <Link href="/sign-in" className="mt-6 inline-block font-mono text-[10px] uppercase tracking-[0.2em] underline">
            Open the approvals inbox
          </Link>
        </div>
      )}
    </Shell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-black/10 pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Keel home">
            <Logo tone="dark" />
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Signed approval link
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-14 md:py-20">{children}</div>
      <footer className="mx-auto max-w-4xl px-6 pb-12 text-[11px] leading-relaxed text-muted-foreground">
        This link is single-purpose and expires with the request. Keel never puts credentials in email.
      </footer>
    </main>
  );
}
