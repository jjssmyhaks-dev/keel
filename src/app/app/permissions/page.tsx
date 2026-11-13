import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { PageHeader, Panel, Stat, StatusBadge, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Permissions" };

export default async function PermissionsPage() {
  const ctx = await getContext();

  const [agents, credentials, grants, connectorMap] = await Promise.all([
    db.agent.findMany({
      where: { environmentId: ctx.environment.id, status: { not: "revoked" } },
      orderBy: { name: "asc" },
    }),
    db.credential.findMany({
      where: { environmentId: ctx.environment.id, revokedAt: null, endUserId: null },
      orderBy: { connectorSlug: "asc" },
    }),
    db.grant.findMany({
      where: { environmentId: ctx.environment.id, endUserId: null },
      include: { credential: true },
    }),
    loadConnectorMap(ctx.environment.id),
  ]);

  const connectorsWithCredentials = [...connectorMap.values()].filter((def) =>
    credentials.some((c) => c.connectorSlug === def.slug),
  );
  const grantByKey = new Map(grants.map((grant) => [`${grant.agentId}:${grant.credentialId}`, grant]));

  let writeGrantsWithoutApproval = 0;
  let wildcardGrants = 0;
  let expiringGrants = 0;
  const soon = new Date(Date.now() + 14 * 86400_000);
  for (const grant of grants) {
    const actions = JSON.parse(grant.actionsJson || "[]") as string[];
    const hasWrite = actions.some((action) => {
      if (action === "*") return true;
      const def = connectorMap.get(grant.credential.connectorSlug)?.actions.find((a) => a.name === action);
      return def ? def.risk !== "read" : true;
    });
    if (hasWrite && !grant.approvalMode) writeGrantsWithoutApproval += 1;
    if (actions.includes("*")) wildcardGrants += 1;
    if (grant.expiresAt && grant.expiresAt < soon) expiringGrants += 1;
  }

  const unmappedAgents = agents.filter((agent) => !grants.some((grant) => grant.agentId === agent.id));

  return (
    <div>
      <PageHeader
        eyebrow="Permissions · matrix"
        title="Access, drawn as a grid."
        description="Every cell is an explicit grant. No grant means no access — agents cannot borrow scopes from each other or from the environment."
        actions={
          <Link href="/app/agents" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
            Manage agents
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Grants" value={grants.length} detail={`${agents.length} agents · ${credentials.length} connections`} accent />
        <Stat label="Grants without explicit mode" value={writeGrantsWithoutApproval} detail={writeGrantsWithoutApproval ? "Risk defaults apply" : "Every write is pinned"} />
        <Stat label="Wildcard grants" value={wildcardGrants} detail={wildcardGrants ? "Allow every action on a connection" : "Actions are named"} />
        <Stat label="Expiring within 14 days" value={expiringGrants} detail={expiringGrants ? "Renew or let them lapse" : "Nothing expiring"} />
      </div>

      {unmappedAgents.length ? (
        <div className="mt-4 border border-[#a56b18]/30 bg-[#a56b18]/[0.06] px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8c5a12] dark:text-[#e8b26a]">
            {unmappedAgents.length} agent{unmappedAgents.length === 1 ? "" : "s"} hold no grants
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#8c5a12] dark:text-[#e8b26a]">
            {unmappedAgents.map((agent) => agent.name).join(", ")} can authenticate but cannot call any service. Grant access or
            suspend them so the fleet stays honest.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        {agents.length && connectorsWithCredentials.length ? (
          <Panel title="Matrix" hint="Row is an agent · column is a connection" bodyClassName="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-black/10 dark:border-border">
                  <th className="sticky left-0 z-10 bg-white px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:bg-card dark:text-muted-foreground">
                    Agent
                  </th>
                  {connectorsWithCredentials.map((def) => (
                    <th key={def.slug} className="px-3 py-3 text-center">
                      <span
                        className="mx-auto flex size-6 items-center justify-center text-white"
                        style={{ background: def.color }}
                        title={def.name}
                      >
                        <ConnectorLogo slug={def.slug} mark={def.mark} mono className="size-3.5" />
                      </span>
                      <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        {def.name.split(" ")[0]}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const agentGrants = grants.filter((grant) => grant.agentId === agent.id);
                  return (
                    <tr key={agent.id} className="border-b border-black/10 last:border-0 hover:bg-black/[0.015] dark:border-border dark:hover:bg-white/[0.02]">
                      <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-normal dark:bg-card">
                        <Link href={`/app/permissions/${agent.id}`} className="group flex items-center gap-2">
                          <span className="text-[12px] group-hover:underline">{agent.name}</span>
                          {agent.status !== "active" ? <StatusBadge status={agent.status} /> : null}
                        </Link>
                        <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{agent.keyMode === "platform" ? "managed" : "byok"}</span>
                      </th>
                      {connectorsWithCredentials.map((def) => {
                        const cred = credentials.find((c) => c.connectorSlug === def.slug);
                        const grant = cred ? grantByKey.get(`${agent.id}:${cred.id}`) : undefined;
                        const actions = grant ? (JSON.parse(grant.actionsJson || "[]") as string[]) : [];
                        const state = !grant
                          ? "none"
                          : actions.some((action) => {
                              if (action === "*") return true;
                              return def.actions.find((a) => a.name === action)?.risk !== "read";
                            })
                            ? "write"
                            : "read";
                        return (
                          <td key={def.slug} className="px-1 py-2 text-center">
                            <Link
                              href={`/app/permissions/${agent.id}#${def.slug}`}
                              className="mx-auto flex size-9 items-center justify-center"
                              title={
                                grant
                                  ? `${actions.length} action${actions.length === 1 ? "" : "s"} · ${grant.approvalMode ?? "policy default"}`
                                  : "No grant"
                              }
                            >
                              <span
                                aria-hidden="true"
                                className={`flex size-6 items-center justify-center border font-mono text-[9px] transition-colors ${
                                  state === "none"
                                    ? "border-dashed border-black/15 text-transparent hover:border-black/40 dark:border-border"
                                    : state === "write"
                                      ? "border-black bg-black text-white"
                                      : "border-[#2f7d5c]/40 bg-[#2f7d5c]/[0.08] text-[#276a4e] dark:text-[#7fd1ab]"
                                }`}
                              >
                                {state === "none" ? "" : actions.length}
                              </span>
                            </Link>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right">
                        <Link href={`/app/permissions/${agent.id}`} className="font-mono text-[10px] text-black/60 underline-offset-2 hover:underline dark:text-muted-foreground">
                          {agentGrants.length} grant{agentGrants.length === 1 ? "" : "s"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        ) : (
          <Panel bodyClassName="p-0">
            <EmptyState
              title="Nothing to map yet"
              description="Register an agent and store a connection, then come back to draw the access grid."
              action={
                <Link href="/app/agents/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                  Register an agent
                </Link>
              }
            />
          </Panel>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {[
          { title: "Least privilege by default", body: "Unfilled cells stay denied. Agents have to be given a specific connection and named actions." },
          { title: "Risk drives approval", body: "Reads run straight through. Writes, destructive calls and money movement route to the approvals inbox in production." },
          { title: "Expiry is a feature", body: "Set grant expiry for contractors and experiments. When the date passes, the proxy denies the call and the audit shows why." },
        ].map((item) => (
          <div key={item.title} className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">{item.title}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-black/65 dark:text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
