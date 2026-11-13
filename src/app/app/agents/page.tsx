import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { PageHeader, Panel, StatusBadge, TabLinks, relativeTime, EmptyState, Notice } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tag?: string; error?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const status = query.status ?? "";

  const agents = await db.agent.findMany({
    where: {
      environmentId: ctx.environment.id,
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}),
    },
    include: {
      grants: { include: { credential: { select: { connectorSlug: true } } } },
      owner: { select: { name: true, email: true } },
      _count: { select: { keys: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const tagged = query.tag ? agents.filter((agent) => (JSON.parse(agent.tagsJson || "[]") as string[]).includes(query.tag!)) : agents;

  return (
    <div>
      <PageHeader
        eyebrow="Agents · identities"
        title="A name, a key, a boundary."
        description="Every agent gets an Ed25519 identity, short-lived tokens and an allow-list of actions. Nothing runs anonymously."
        actions={
          <>
            <Link href="/app/permissions" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Permission matrix
            </Link>
            <Link href="/app/agents/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
              Register agent
            </Link>
          </>
        }
      />

      {query.error ? <Notice kind="error">That action failed ({query.error}). Check your role and try again.</Notice> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TabLinks
          current={status ? `/app/agents?status=${status}` : "/app/agents"}
          items={[
            { href: "/app/agents", label: "All", count: agents.length },
            { href: "/app/agents?status=active", label: "Active" },
            { href: "/app/agents?status=paused", label: "Paused" },
            { href: "/app/agents?status=suspended", label: "Suspended" },
            { href: "/app/agents?status=revoked", label: "Revoked" },
          ]}
        />
        <form className="flex items-center gap-2" action="/app/agents">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search agents…"
            className="w-48 border border-black/45 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
          />
          <button className="border border-black/45 bg-white px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-white/40 dark:bg-card">
            Search
          </button>
        </form>
      </div>

      <Panel bodyClassName="p-0">
        {tagged.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-black/10 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:border-border dark:text-muted-foreground">
                  <th className="px-4 py-2.5 font-normal">Agent</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal">Grants</th>
                  <th className="px-4 py-2.5 font-normal">Owner</th>
                  <th className="px-4 py-2.5 font-normal">Last active</th>
                  <th className="px-4 py-2.5 font-normal">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-border">
                {tagged.map((agent) => {
                  const connectors = [...new Set(agent.grants.map((grant) => grant.credential.connectorSlug))];
                  return (
                    <tr key={agent.id} className="group transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <Link href={`/app/agents/${agent.id}`} className="flex items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center border border-black/45 bg-[#faf9f6] font-mono text-[9px] dark:border-white/40 dark:bg-background">
                            {agent.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[12px] font-medium">{agent.name}</span>
                              {agent.kind === "external" ? (
                                <span className="border border-[#25567a]/35 px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-[#25567a] dark:text-[#93c5e8]">
                                  external · {agent.externalOrgName ?? "trust"}
                                </span>
                              ) : null}
                              {agent.autonomousMode ? (
                                <span className="border border-[#7a3db8]/35 px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-[#7a3db8]">
                                  auto
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                              {connectors.length ? connectors.join(" · ") : "no connections"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={agent.status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">{agent.grants.length}</td>
                      <td className="px-4 py-3 text-[11px] text-black/65 dark:text-muted-foreground">
                        {agent.owner?.name ?? "Unassigned"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-black/60 dark:text-muted-foreground">
                        {agent.lastActiveAt ? relativeTime(agent.lastActiveAt) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-black/60 dark:text-muted-foreground">
                        {relativeTime(agent.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/app/agents/${agent.id}`} className="font-mono text-[10px] text-black/60 group-hover:text-black dark:text-muted-foreground dark:group-hover:text-foreground">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={q ? "No agents match that search" : "No agents yet"}
            description={
              q
                ? "Try a shorter name or clear the filters."
                : "Register an agent to get a fingerprint, a key and a policy boundary. It takes about nine seconds."
            }
            action={
              <Link href="/app/agents/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                Register an agent
              </Link>
            }
          />
        )}
      </Panel>
    </div>
  );
}
