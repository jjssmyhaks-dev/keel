import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { saveGrantAction, activateGrantAction } from "@/app/app/actions";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader, Panel, StatusBadge, RiskBadge, Notice, relativeTime, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Permissions" };

const ERROR_COPY: Record<string, string> = {
  permission: "Your role cannot change grants in this environment.",
  missing: "That agent or connection no longer exists.",
  conditions: "Conditions must be valid JSON. Leave the field as {} if unsure.",
};

const APPROVAL_OPTIONS = [
  { value: "", label: "Use policy default" },
  { value: "allow", label: "Allow without approval" },
  { value: "require_approval", label: "Require approval" },
  { value: "deny", label: "Deny these actions" },
];

export default async function PermissionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { agentId } = await params;
  const query = await searchParams;

  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) notFound();

  const [credentials, grants, policies, changes, connectorMap] = await Promise.all([
    db.credential.findMany({
      where: { environmentId: ctx.environment.id, revokedAt: null },
      orderBy: { connectorSlug: "asc" },
    }),
    db.grant.findMany({ where: { agentId: agent.id, environmentId: ctx.environment.id } }),
    db.approvalPolicy.findMany({
      where: { environmentId: ctx.environment.id, OR: [{ agentId: agent.id }, { agentId: null }] },
      orderBy: [{ agentId: "desc" }, { actionPattern: "asc" }],
    }),
    db.permissionChange.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    loadConnectorMap(ctx.environment.id),
  ]);

  const grantFor = (credentialId: string) => grants.find((grant) => grant.credentialId === credentialId);
  const canManage = ctx.capabilities.manageGrants;

  const actionCount = grants.reduce((sum, grant) => sum + (JSON.parse(grant.actionsJson || "[]") as string[]).length, 0);

  return (
    <div>
      <PageHeader
        eyebrow={`Permissions · ${agent.name}`}
        title="Grant exactly this much."
        description="Tick the actions the agent may run, narrow the resource pattern and decide whether a human has to sign off. Everything else stays denied."
        actions={
          <>
            <Link href="/app/permissions" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Matrix
            </Link>
            <Link href={`/app/agents/${agent.id}`} className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              Agent
            </Link>
          </>
        }
      />

      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That change could not be saved."}</Notice> : null}
      {query.saved ? <Notice kind="ok">Permissions saved. New tokens carry the updated scope list.</Notice> : null}
      {query.removed ? <Notice kind="ok">Grant removed. Calls to that connection are now denied.</Notice> : null}
      {query.activated ? <Notice kind="ok">Just-in-time access activated for 60 minutes. It reverts to inactive when it expires.</Notice> : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <StatusBadge status={agent.status} />
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">
          {grants.length} connection{grants.length === 1 ? "" : "s"} granted
        </span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">{actionCount} actions allowed</span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground capitalize">
          {ctx.environment.type} defaults apply
        </span>
        {agent.safeLaunchUntil && agent.safeLaunchUntil > new Date() ? (
          <span className="ml-auto border border-[#a56b18]/35 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8c5a12] dark:text-[#e8b26a]">
            safe launch until {formatDate(agent.safeLaunchUntil)}
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-4">
          {credentials.length ? (
            credentials.map((credential) => {
              const def = connectorMap.get(credential.connectorSlug);
              if (!def) return null;
              const grant = grantFor(credential.id);
              const grantedActions = grant ? (JSON.parse(grant.actionsJson || "[]") as string[]) : [];
              const conditions = grant?.conditionsJson && grant.conditionsJson !== "{}" ? grant.conditionsJson : "";
              return (
                <section key={credential.id} id={def.slug} className="border border-black/10 bg-white dark:border-border dark:bg-card">
                  <header className="flex flex-wrap items-center gap-2.5 border-b border-black/10 px-4 py-3 dark:border-border">
                    <span
                      className="flex size-7 items-center justify-center text-white"
                      style={{ background: def.color }}
                    >
                      <ConnectorLogo slug={def.slug} mark={def.mark} mono className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium">{def.name}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                        {credential.name} · {credential.maskedHint || "••••"}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {grant ? (
                        <span className="border border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#245f47] dark:text-[#7fd1ab]">
                          granted
                        </span>
                      ) : (
                        <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                          no access
                        </span>
                      )}
                      {grant?.justInTime ? (
                        <span
                          className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                            grant.activatedAt
                              ? "border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] text-[#245f47]"
                              : "border-[#a56b18]/35 bg-[#a56b18]/[0.06] text-[#8c5a12] dark:text-[#e8b26a]"
                          }`}
                        >
                          {grant.activatedAt ? "JIT active" : "JIT inactive"}
                        </span>
                      ) : null}
                      <Link href={`/app/vault/${credential.id}`} className="font-mono text-[9px] uppercase tracking-[0.1em] underline-offset-2 hover:underline">
                        Connection
                      </Link>
                    </div>
                  </header>

                  <form action={saveGrantAction} className="space-y-4 p-4">
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="credentialId" value={credential.id} />

                    <div>
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                          Actions
                        </p>
                        <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          {grantedActions.length} of {def.actions.length} named
                        </p>
                      </div>
                      <div className="mt-1.5 divide-y divide-black/10 border border-black/10 dark:divide-border dark:border-border">
                        {def.actions.map((action) => (
                          <label
                            key={action.name}
                            className="flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                          >
                            <input
                              type="checkbox"
                              name="actions"
                              value={action.name}
                              defaultChecked={grantedActions.includes(action.name) || grantedActions.includes("*")}
                              className="mt-0.5 size-3.5 accent-black"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[12px]">{action.label}</span>
                                <RiskBadge risk={action.risk} />
                                <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{action.method}</span>
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                                {action.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <label className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
                        <input
                          type="checkbox"
                          name="actions"
                          value="*"
                          defaultChecked={grantedActions.includes("*")}
                          className="mt-0.5 size-3.5 accent-black"
                        />
                        All actions, including future ones. Broad grants are flagged in the matrix.
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                          {def.resourceLabel} pattern
                        </label>
                        <input
                          name="resourcePattern"
                          defaultValue={grant?.resourcePattern ?? "*"}
                          placeholder={def.resourcePlaceholder}
                          className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                        />
                        <p className="mt-1 text-[10px] text-black/60 dark:text-muted-foreground">
                          Glob or comma list. Example: {def.resourcePlaceholder}
                        </p>
                      </div>
                      <div>
                        <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                          Approval
                        </label>
                        <select
                          name="approvalMode"
                          defaultValue={grant?.approvalMode ?? ""}
                          className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                        >
                          {APPROVAL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                          Expires
                        </label>
                        <input
                          type="date"
                          name="expiresAt"
                          defaultValue={grant?.expiresAt ? grant.expiresAt.toISOString().slice(0, 10) : ""}
                          className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                          Purpose
                        </label>
                        <input
                          name="purpose"
                          defaultValue={grant?.purpose ?? ""}
                          placeholder="Why does it need this?"
                          className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-1.5 text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                        />
                      </div>
                    </div>

                    <label className="flex items-start gap-2 border border-black/10 p-3 text-[11px] leading-relaxed text-black/65 dark:border-border dark:text-muted-foreground">
                      <input
                        type="checkbox"
                        name="justInTime"
                        defaultChecked={grant?.justInTime ?? false}
                        className="mt-0.5 size-3.5 accent-black"
                      />
                      <span>
                        <span className="font-medium text-black dark:text-foreground">Just-in-time access.</span> The grant
                        starts inactive. The agent must request activation and an approver must approve it before any call is
                        allowed. Saving an existing standing grant as JIT deactivates it immediately.
                        {grant?.justInTime && grant.activatedAt ? (
                          <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-[#245f47]">
                            active until {formatDate(grant.expiresAt)}
                          </span>
                        ) : null}
                      </span>
                    </label>

                    <details className="border border-black/10 dark:border-border" open={Boolean(conditions)}>
                      <summary className="cursor-pointer px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                        Conditions (JSON) {conditions ? "· configured" : ""}
                      </summary>
                      <div className="border-t border-black/10 p-3 dark:border-border">
                        <textarea
                          name="conditions"
                          rows={4}
                          defaultValue={conditions || ""}
                          placeholder={'{"maxCallsPerPeriod": 50, "allowedDays": "mon,tue,wed,thu,fri", "timezone": "Europe/London", "maxAmount": 500}'}
                          spellCheck={false}
                          className="w-full resize-none border border-black/15 bg-[#0b0b0b] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[#e8e6e1] outline-none focus:border-black"
                        />
                        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-black/60 dark:text-muted-foreground">
                          Supported keys: maxCallsPerPeriod, periodHours, timeWindowStart, timeWindowEnd, timezone,
                          allowedDays, allowedIps (CIDR), maxAmount, approvalAboveAmount, amountField. Missing or invalid
                          condition data fails closed.
                        </p>
                      </div>
                    </details>

                    <div className="border-t border-black/10 pt-3 dark:border-border">
                      <button
                        disabled={!canManage}
                        className="w-full border border-black bg-black px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40 sm:w-auto"
                      >
                        {grant ? "Save grant" : "Grant access"}
                      </button>
                    </div>
                    {grant ? (
                      <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        Updated {formatDate(grant.createdAt)} · expires {grant.expiresAt ? formatDate(grant.expiresAt) : "never"}
                      </p>
                    ) : (
                      <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        Submitting with no actions selected removes the grant.
                      </p>
                    )}
                  </form>
                  {grant?.justInTime && !grant.activatedAt ? (
                    <form action={activateGrantAction} className="flex flex-wrap items-center gap-3 border-t border-black/10 px-4 py-2.5 dark:border-border">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input type="hidden" name="grantId" value={grant.id} />
                      <button
                        disabled={!canManage}
                        className="border border-black bg-black px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
                      >
                        Activate for 60 minutes
                      </button>
                      <span className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                        Or let the agent request activation so the reason and approval are on the record.
                      </span>
                    </form>
                  ) : null}
                  {grant ? (
                    <form action={saveGrantAction} className="border-t border-black/10 px-4 py-2.5 dark:border-border">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input type="hidden" name="credentialId" value={credential.id} />
                      <ConfirmButton
                        message={`Remove ${agent.name}'s access to ${credential.name}? Calls will be denied immediately.`}
                        className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline"
                      >
                        Remove this grant
                      </ConfirmButton>
                    </form>
                  ) : null}
                </section>
              );
            })
          ) : (
            <Panel title="No connections" hint="The vault is empty" bodyClassName="p-6">
              <p className="text-[12px] leading-relaxed text-black/65 dark:text-muted-foreground">
                Store a connection first. Grants reference a connection, so there is nothing to scope yet.
              </p>
              <Link href="/app/vault/new" className="mt-3 inline-block border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                Add a connection
              </Link>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="How a call is evaluated" hint="In order" bodyClassName="p-4">
            <ol className="space-y-2.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              {[
                "Token signature and revocation are checked on every call.",
                "Agent must be active and the connection must not be revoked.",
                "A grant must exist, and it must not be expired.",
                "The action must be named in the grant (or covered by a wildcard).",
                "The resource must match the grant pattern.",
                "Conditions (time, IP, call caps) are evaluated.",
                "Approval mode decides: allow, require approval, or deny.",
              ].map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Approval policies" hint="Applies before the risk default" bodyClassName="p-0">
            {policies.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {policies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px]">{policy.actionPattern}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        {policy.agentId ? "this agent" : "environment-wide"}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em]">{policy.mode}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-4 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                No pattern policies. Risk defaults apply — reads allowed, everything else needs approval in production.
              </p>
            )}
            <p className="border-t border-black/10 px-4 py-2.5 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
              A grant-level approval mode overrides these policies for that connection.
            </p>
          </Panel>

          <Panel title="Change log" hint="Permission diffs" bodyClassName="p-0">
            {changes.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {changes.map((change) => {
                  const after = JSON.parse(change.afterJson || "{}") as { actions?: string[]; approvalMode?: string | null };
                  return (
                    <div key={change.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px]">{change.change}</p>
                        <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{relativeTime(change.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {change.actorName}
                        {after.actions ? ` · ${after.actions.length} action(s)` : ""}
                        {after.approvalMode ? ` · ${after.approvalMode}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-4 text-[11px] text-black/60 dark:text-muted-foreground">No permission changes recorded yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
