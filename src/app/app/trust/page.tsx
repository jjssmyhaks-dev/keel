import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { PageHeader, Panel, StatusBadge, TabLinks, Notice, EmptyState, relativeTime } from "@/components/app/ui";
import { parseStringArray } from "@/lib/consent";
import { acceptTrustAction, declineTrustAction, inviteTrustAction, revokeTrustAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trust" };

const ERROR_COPY: Record<string, string> = {
  capability: "Your role cannot manage trust relationships.",
  agent: "Provide the external agent's id.",
  agent_not_found: "No agent with that id exists.",
  agent_not_internal: "Only internal agents can be invited into a trust relationship.",
  agent_inactive: "That agent is not active.",
  agent_private: "That agent is private and cannot receive trust invitations.",
  environment_mismatch: "Both environments must be the same type. Production trusts production; development trusts development.",
  same_organization: "An agent cannot be invited into its own organization.",
  exists: "A relationship with this agent is already open.",
  not_found: "That relationship no longer exists.",
  not_external_side: "Only the invited organization can act on this invitation.",
  not_invited: "That invitation is no longer open.",
  owner_missing: "The owner environment no longer exists.",
  not_a_party: "Your environment is not part of that relationship.",
};

export default async function TrustPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; error?: string; invited?: string; accepted?: string; declined?: string; revoked?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const side = query.side === "external" ? "external" : "owner";

  const relationships = await db.trustRelationship.findMany({
    where: side === "owner" ? { ownerEnvironmentId: ctx.environment.id } : { externalEnvironmentId: ctx.environment.id },
    orderBy: { invitedAt: "desc" },
    take: 100,
  });

  const agentIds = [
    ...new Set(
      relationships.flatMap((row) => [row.externalAgentId, row.shadowAgentId].filter((id): id is string => Boolean(id))),
    ),
  ];
  const agents = agentIds.length
    ? await db.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, status: true, kind: true, externalOrgName: true },
      })
    : [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const envIds = [
    ...new Set(
      relationships.flatMap((row) => [row.ownerEnvironmentId, row.externalEnvironmentId]),
    ),
  ];
  const environments = envIds.length
    ? await db.environment.findMany({
        where: { id: { in: envIds } },
        select: { id: true, project: { select: { org: { select: { name: true } } } } },
      })
    : [];
  const orgByEnv = new Map(environments.map((env) => [env.id, env.project.org.name]));

  const ownerSide = side === "owner";
  const canAct = ctx.can("manage_agents");

  return (
    <div>
      <PageHeader
        eyebrow="Trust · cross-organization"
        title="Borrow an agent, not a password."
        description="Another organization's agent can act inside this environment as a shadow agent you control. Every non-read action from a shadow agent needs a human here, even in development."
        actions={
          <Link href="/app/agents" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
            Agents
          </Link>
        }
      />

      {query.invited ? <Notice kind="ok">Invitation sent. The other organization's owners and admins have been notified.</Notice> : null}
      {query.accepted ? <Notice kind="ok">Trust accepted. A shadow agent now exists in the owner environment; configure its grants like any other agent.</Notice> : null}
      {query.declined ? <Notice kind="info">Invitation declined. Nothing was shared.</Notice> : null}
      {query.revoked ? <Notice kind="ok">Relationship revoked. Every token minted through it fails on the next call.</Notice> : null}
      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That action failed. Check the relationship and try again."}</Notice> : null}

      <div className="mb-5">
        <TabLinks
          current={side === "owner" ? "/app/trust" : "/app/trust?side=external"}
          items={[
            { href: "/app/trust", label: "Access I gave", count: ownerSide ? relationships.length : undefined },
            { href: "/app/trust?side=external", label: "Access my agents have" },
          ]}
        />
      </div>

      {!relationships.length ? (
        <EmptyState
          title={ownerSide ? "No agent is acting here." : "Your agents are not acting elsewhere."}
          description={
            ownerSide
              ? "Invite an internal agent from another organization. You choose the scope cap; every action still runs through your grants, policy and approvals."
              : "When another organization invites one of your agents, the invitation appears here for an owner or admin to accept."
          }
        />
      ) : (
        <Panel bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-black/10 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:border-border dark:text-muted-foreground">
                  <th className="px-4 py-2.5 font-normal">{ownerSide ? "External agent" : "Agent"}</th>
                  <th className="px-4 py-2.5 font-normal">{ownerSide ? "Organization" : "Owner organization"}</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal">Scope cap</th>
                  <th className="px-4 py-2.5 font-normal">Invited</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-border">
                {relationships.map((relationship) => {
                  const external = agentById.get(relationship.externalAgentId);
                  const shadow = relationship.shadowAgentId ? agentById.get(relationship.shadowAgentId) : null;
                  const otherOrg = ownerSide
                    ? orgByEnv.get(relationship.externalEnvironmentId) ?? external?.externalOrgName ?? "—"
                    : orgByEnv.get(relationship.ownerEnvironmentId) ?? "—";
                  const maxScopes = parseStringArray(relationship.maxScopesJson);
                  return (
                    <tr key={relationship.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="text-[12px] font-medium">{ownerSide ? external?.name ?? relationship.externalAgentId : shadow?.name ?? external?.name ?? relationship.externalAgentId}</p>
                        {ownerSide && shadow ? (
                          <Link href={`/app/agents/${shadow.id}`} className="font-mono text-[9px] uppercase tracking-[0.12em] underline">
                            Shadow agent · grants
                          </Link>
                        ) : null}
                        {relationship.note ? <p className="mt-1 max-w-xs text-[11px] text-black/60 dark:text-muted-foreground">{relationship.note}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-[12px]">{otherOrg}</td>
                      <td className="px-4 py-3"><StatusBadge status={relationship.status} /></td>
                      <td className="px-4 py-3 font-mono text-[10px] text-black/60 dark:text-muted-foreground">
                        {maxScopes.length ? maxScopes.join(" · ") : "owner grants only"}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-black/60 dark:text-muted-foreground">{relativeTime(relationship.invitedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {ownerSide && relationship.status !== "revoked" && relationship.status !== "declined" ? (
                            <form action={revokeTrustAction}>
                              <input type="hidden" name="id" value={relationship.id} />
                              <button
                                disabled={!canAct}
                                className="border border-[#b3402f]/40 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#b3402f] hover:border-[#b3402f] disabled:opacity-40"
                              >
                                Revoke
                              </button>
                            </form>
                          ) : null}
                          {!ownerSide && relationship.status === "invited" ? (
                            <>
                              <form action={acceptTrustAction}>
                                <input type="hidden" name="id" value={relationship.id} />
                                <button
                                  disabled={!canAct}
                                  className="border border-black bg-black px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white disabled:opacity-40"
                                >
                                  Accept
                                </button>
                              </form>
                              <form action={declineTrustAction}>
                                <input type="hidden" name="id" value={relationship.id} />
                                <button
                                  disabled={!canAct}
                                  className="border border-black/30 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black disabled:opacity-40"
                                >
                                  Decline
                                </button>
                              </form>
                            </>
                          ) : null}
                          {!ownerSide && (relationship.status === "active" || relationship.status === "declined") ? (
                            <form action={revokeTrustAction}>
                              <input type="hidden" name="id" value={relationship.id} />
                              <button
                                disabled={!canAct}
                                className="border border-[#b3402f]/40 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#b3402f] hover:border-[#b3402f] disabled:opacity-40"
                              >
                                Withdraw
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {ownerSide ? (
        <Panel title="Invite an agent" hint="Owner side · capability manage_agents" className="mt-6">
          <form action={inviteTrustAction} className="grid gap-4 md:grid-cols-2">
            <label className="text-[11px]">
              External agent ID
              <input
                name="externalAgentId"
                required
                placeholder="ag_…"
                className="mt-1 w-full border border-black/45 bg-white px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
              />
              <span className="mt-1 block text-[10px] text-black/55 dark:text-muted-foreground">
                The other organization shares this id. The agent must be active, internal and not private, in an environment of the same type.
              </span>
            </label>
            <label className="text-[11px]">
              Scope cap (optional)
              <textarea
                name="maxScopes"
                rows={2}
                placeholder="gmail.messages.read*"
                className="mt-1 w-full border border-black/45 bg-white px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
              />
              <span className="mt-1 block text-[10px] text-black/55 dark:text-muted-foreground">
                One action glob per line. Empty means only your grants limit the agent.
              </span>
            </label>
            <label className="text-[11px] md:col-span-2">
              Note
              <input
                name="note"
                maxLength={500}
                placeholder="Why this agent needs access"
                className="mt-1 w-full border border-black/45 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
              />
            </label>
            <div className="md:col-span-2">
              <button
                disabled={!canAct}
                className="border border-black bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                Send invitation
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
