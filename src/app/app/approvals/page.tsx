import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { expireStaleApprovals } from "@/lib/approvals";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { PageHeader, Panel, Stat, StatusBadge, RiskBadge, TabLinks, EmptyState, relativeTime, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Approvals" };

const TABS = ["pending", "approved", "denied", "expired", "all"] as const;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  await expireStaleApprovals(ctx.environment.id);

  const status = TABS.includes((query.status ?? "pending") as (typeof TABS)[number]) ? (query.status ?? "pending") : "pending";

  const [approvals, counts, connectorMap] = await Promise.all([
    db.approvalRequest.findMany({
      where: {
        environmentId: ctx.environment.id,
        ...(status === "all" ? {} : { status }),
      },
      include: {
        agent: { select: { id: true, name: true, status: true } },
        credential: { select: { name: true, connectorSlug: true, maskedHint: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
    db.approvalRequest.groupBy({
      by: ["status"],
      where: { environmentId: ctx.environment.id },
      _count: { _all: true },
    }),
    loadConnectorMap(ctx.environment.id),
  ]);

  const countFor = (key: string) =>
    key === "all" ? counts.reduce((sum, row) => sum + row._count._all, 0) : counts.find((row) => row.status === key)?._count._all ?? 0;
  const pending = countFor("pending");
  const oldest = approvals.find((approval) => approval.status === "pending");

  return (
    <div>
      <PageHeader
        eyebrow="Approvals · human in the loop"
        title="Nothing moves without a name."
        description="Every gated call waits here until a person decides. Approving executes the exact payload that was requested — no edits, no substitutions."
        actions={
          <Link href="/app/security" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Approval settings
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting on a human" value={pending} detail={oldest ? `oldest ${relativeTime(oldest.createdAt)}` : "inbox is clear"} accent />
        <Stat label="Approved" value={countFor("approved")} detail="Executed after sign-off" />
        <Stat label="Denied" value={countFor("denied")} detail="Blocked by a reviewer" />
        <Stat label="Expired" value={countFor("expired")} detail="No decision in time" />
      </div>

      <div className="mt-6">
        <TabLinks
          current={`/app/approvals${status === "pending" ? "" : `?status=${status}`}`}
          items={TABS.map((tab) => ({
            href: tab === "pending" ? "/app/approvals" : `/app/approvals?status=${tab}`,
            label: tab[0].toUpperCase() + tab.slice(1),
            count: countFor(tab),
          }))}
        />
      </div>

      <div className="mt-5">
        {approvals.length ? (
          <div className="divide-y divide-black/10 border border-black/10 bg-white dark:divide-border dark:border-border dark:bg-card">
            {approvals.map((approval) => {
              const def = connectorMap.get(approval.credential?.connectorSlug ?? "");
              const open = approval.status === "pending";
              return (
                <Link
                  key={approval.id}
                  href={`/app/approvals/${approval.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center text-white"
                    style={{ background: def?.color ?? "#333" }}
                  >
                    <ConnectorLogo slug={approval.credential?.connectorSlug ?? ""} mark={def?.mark} mono className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{approval.summary}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] uppercase tracking-[0.1em] text-black/40 dark:text-muted-foreground">
                      <span>{approval.agent.name}</span>
                      <span>·</span>
                      {approval.kind === "grant" ? (
                        <>
                          <span className="text-[#25567a]">JIT access</span>
                          <span>·</span>
                        </>
                      ) : null}
                      <span>{relativeTime(approval.createdAt)}</span>
                      <span>·</span>
                      <span className={open ? "text-[#8c5a12]" : ""}>
                        {open ? `expires ${relativeTime(approval.expiresAt)}` : `decided ${formatDate(approval.decidedAt)}`}
                      </span>
                      {open && approval.slaDueAt ? (
                        <>
                          <span>·</span>
                          <span className={approval.escalatedAt ? "text-[#8c3225]" : "text-[#8c5a12]"}>
                            {approval.escalatedAt ? "escalated" : `SLA ${relativeTime(approval.slaDueAt)}`}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <RiskBadge risk={approval.risk} />
                  <StatusBadge status={approval.status} />
                  {open ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-black/45 dark:text-muted-foreground">Review →</span> : null}
                </Link>
              );
            })}
          </div>
        ) : (
          <Panel bodyClassName="p-0">
            <EmptyState
              title={status === "pending" ? "Inbox zero." : `No ${status} requests.`}
              description={
                status === "pending"
                  ? "No agent is waiting on a human right now. Gated calls will appear here the moment they happen."
                  : "Nothing in this bucket for the current environment. Switch environments to see the other side."
              }
              action={
                <Link href="/app/agents" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                  Review agents
                </Link>
              }
            />
          </Panel>
        )}
      </div>

      <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-black/35 dark:text-muted-foreground">
        Approvers can also sign off from a signed email link · decisions are written to the audit chain
      </p>
    </div>
  );
}
