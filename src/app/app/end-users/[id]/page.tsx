import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { parseStringArray } from "@/lib/consent";
import { humanizeAction } from "@/lib/control-center";
import { connector } from "@/lib/connectors";
import { PageHeader, Panel, Notice, StatusBadge, formatDate } from "@/components/app/ui";
import {
  completeDataRequestAction,
  deleteEndUserAction,
  disconnectEndUserCredentialAction,
  revokeEndUserConsentAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "End user" };

export default async function EndUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { id } = await params;
  const query = await searchParams;
  const endUser = await db.endUser.findFirst({ where: { id, projectId: ctx.project.id } });
  if (!endUser) redirect("/app/end-users?error=missing");

  const [consents, credentials, dataRequests, events] = await Promise.all([
    db.consent.findMany({ where: { endUserId: id, projectId: ctx.project.id }, orderBy: { grantedAt: "desc" } }),
    db.credential.findMany({
      where: { endUserId: id, environment: { projectId: ctx.project.id } },
      select: {
        id: true,
        name: true,
        connectorSlug: true,
        status: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.dataRequest.findMany({ where: { endUserId: id, projectId: ctx.project.id }, orderBy: { createdAt: "desc" } }),
    db.agentEvent.findMany({ where: { endUserId: id }, orderBy: { occurredAt: "desc" }, take: 20 }),
  ]);
  const agentIds = [...new Set([...consents.map((consent) => consent.agentId), ...events.map((event) => event.agentId)])];
  const agents = await db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } });
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const now = new Date();
  const canManageConsents = ctx.can("manage_agents");
  const canManageConnections = ctx.can("manage_credentials");
  const canManagePrivacy = ctx.can("manage_security");

  return (
    <div>
      <PageHeader
        eyebrow={`End user · ${endUser.externalUserId}`}
        title={endUser.email ?? endUser.externalUserId}
        description={`Created ${formatDate(endUser.createdAt)} · last seen ${formatDate(endUser.lastSeenAt)}. This person's connections are isolated from the organization's own vault.`}
        actions={
          <Link href="/app/end-users" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
            All end users
          </Link>
        }
      />

      {query.revoked ? <Notice kind="ok">Consent revoked and its grants expired.</Notice> : null}
      {query.disconnected ? <Notice kind="ok">Connection destroyed. Every grant for it expired.</Notice> : null}
      {query.request === "completed" ? <Notice kind="ok">Data request marked complete.</Notice> : null}
      {query.error ? (
        <Notice kind="error">
          {query.error === "permission"
            ? "Your role cannot perform that action."
            : query.error === "confirm"
              ? "Type the external user id exactly to confirm deletion."
              : "That record could not be found."}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel title="Permissions" hint={`${consents.length} consent record${consents.length === 1 ? "" : "s"}`} bodyClassName="p-0">
            {consents.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-black/10 font-mono text-[9px] uppercase tracking-[0.14em] text-black/55 dark:border-border dark:text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Agent</th>
                      <th className="px-4 py-2.5">Allowed actions</th>
                      <th className="px-4 py-2.5">Granted</th>
                      <th className="px-4 py-2.5">Expires</th>
                      <th className="px-4 py-2.5">State</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10 dark:divide-border">
                    {consents.map((consent) => {
                      const active = !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > now);
                      return (
                        <tr key={consent.id}>
                          <td className="px-4 py-3">{agentNames.get(consent.agentId) ?? consent.agentId.slice(0, 8)}</td>
                          <td className="max-w-[18rem] px-4 py-3 font-mono text-[10px] text-black/65 dark:text-muted-foreground">
                            {parseStringArray(consent.scopesJson).map(humanizeAction).join(" · ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-black/65 dark:text-muted-foreground">{formatDate(consent.grantedAt)}</td>
                          <td className="px-4 py-3 text-black/65 dark:text-muted-foreground">
                            {consent.expiresAt ? formatDate(consent.expiresAt) : "No expiry"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={consent.revokedAt ? "revoked" : active ? "active" : "expired"} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {active && canManageConsents ? (
                              <form action={revokeEndUserConsentAction}>
                                <input type="hidden" name="consentId" value={consent.id} />
                                <button type="submit" className="border border-black/45 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-white/40">
                                  Revoke
                                </button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-5 text-[12px] text-black/60 dark:text-muted-foreground">No consent has been granted.</p>
            )}
          </Panel>

          <Panel title="Activity" hint="Agent events tied to this person" bodyClassName="p-0">
            {events.length ? (
              <ul className="divide-y divide-black/10 text-[12px] dark:divide-border">
                {events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span>
                      <span className="font-medium">{agentNames.get(event.agentId) ?? "Agent"}</span>{" "}
                      <span className="text-black/60 dark:text-muted-foreground">
                        {humanizeAction(event.action)} on {connector(event.connectorSlug)?.name ?? event.connectorSlug}
                      </span>
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/55 dark:text-muted-foreground">
                      {event.decision} · {formatDate(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-[12px] text-black/60 dark:text-muted-foreground">No agent activity yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Connections" hint="Stored for this person only" bodyClassName="p-0">
            {credentials.length ? (
              <ul className="divide-y divide-black/10 text-[12px] dark:divide-border">
                {credentials.map((credential) => (
                  <li key={credential.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{connector(credential.connectorSlug)?.name ?? credential.connectorSlug}</p>
                        <p className="text-[11px] text-black/60 dark:text-muted-foreground">{credential.name}</p>
                      </div>
                      <StatusBadge status={credential.revokedAt ? "revoked" : credential.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/50 dark:text-muted-foreground">
                        {credential.lastUsedAt ? `Last used ${formatDate(credential.lastUsedAt)}` : "Never used"}
                      </p>
                      {!credential.revokedAt && canManageConnections ? (
                        <form action={disconnectEndUserCredentialAction}>
                          <input type="hidden" name="credentialId" value={credential.id} />
                          <button type="submit" className="border border-black/45 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-white/40">
                            Disconnect
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-[12px] text-black/60 dark:text-muted-foreground">No connected accounts.</p>
            )}
          </Panel>

          <Panel title="Data requests" hint="Privacy obligations" bodyClassName="p-0">
            {dataRequests.length ? (
              <ul className="divide-y divide-black/10 text-[12px] dark:divide-border">
                {dataRequests.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="capitalize">{request.kind} request</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/50 dark:text-muted-foreground">
                        {formatDate(request.createdAt)}
                        {request.completedAt ? ` · completed ${formatDate(request.completedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={request.status} />
                      {request.status === "open" && canManagePrivacy ? (
                        <form action={completeDataRequestAction}>
                          <input type="hidden" name="requestId" value={request.id} />
                          <button type="submit" className="border border-black bg-black px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white dark:border-foreground dark:bg-foreground dark:text-background">
                            Mark complete
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-[12px] text-black/60 dark:text-muted-foreground">No data requests.</p>
            )}
          </Panel>

          <Panel title="Delete this person's data" hint="Irreversible · owners and admins" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Revokes every consent, expires every grant, destroys stored connections and anonymizes the profile. Audit events
              remain; the email does not.
            </p>
            {canManagePrivacy ? (
              <form action={deleteEndUserAction} className="mt-3 space-y-2">
                <input type="hidden" name="endUserId" value={endUser.id} />
                <label htmlFor="confirm" className="block font-mono text-[9px] uppercase tracking-[0.14em] text-black/55 dark:text-muted-foreground">
                  Type {endUser.externalUserId} to confirm
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  required
                  autoComplete="off"
                  className="w-full border border-[#b3402f]/45 bg-white px-2.5 py-2 text-[12px] outline-none focus:border-[#b3402f] dark:bg-background"
                />
                <button type="submit" className="border border-[#b3402f] bg-[#b3402f] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                  Delete end-user data
                </button>
              </form>
            ) : (
              <p className="mt-3 text-[11px] text-black/55 dark:text-muted-foreground">Your role cannot delete end-user data.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
