import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { actionLabel } from "@/lib/audit";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { formatFingerprint } from "@/lib/crypto";
import { AGENT_TYPES, agentTypeLabel } from "@/lib/agent-types";
import {
  setAgentStatusAction,
  killSwitchAction,
  rotateAgentKeyAction,
  updateAgentAction,
} from "@/app/app/actions";
import {
  createWorkloadIdentityAction,
  deleteWorkloadIdentityAction,
  toggleWorkloadIdentityAction,
} from "@/app/app/agents/workload-actions";
import { AgentClientSecrets } from "@/components/app/agent-client-secrets";
import { TokenIssuer } from "@/components/app/token-issuer";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader, Panel, StatusBadge, RiskBadge, Notice, relativeTime, formatDate, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent" };

const STATUS_ERROR: Record<string, string> = {
  permission: "Your role cannot change agents in this environment.",
  production: "Only owners and admins can change production agents.",
  missing: "That agent no longer exists.",
  revoked: "Revocation is permanent. Create a new agent instead.",
  client_key: "This agent holds its own key. Rotate it from your own key management.",
};

const WI_ERROR: Record<string, string> = {
  permission: "Your role cannot manage workload identities in this environment.",
  missing: "That workload identity no longer exists.",
  invalid: "Check the workload identity fields and try again.",
  invalid_issuer: "The issuer must be an https:// URL or a spiffe:// ID.",
  invalid_jwks_url: "The JWKS URL must be a publicly reachable HTTPS endpoint.",
  jwks_required: "Provide a JWKS URL for the identity provider.",
  invalid_ttl: "Token TTL must be between 60 and 3600 seconds.",
  invalid_agent: "That agent cannot hold a workload identity.",
};

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { id } = await params;
  const query = await searchParams;

  const agent = await db.agent.findFirst({
    where: { id, environmentId: ctx.environment.id },
    include: {
      keys: { orderBy: { createdAt: "desc" } },
      grants: { include: { credential: true } },
      approvalPolicies: true,
      clientSecrets: { orderBy: { createdAt: "desc" } },
      owner: { select: { name: true, email: true } },
      delegationsParent: { include: { child: { select: { id: true, name: true, status: true } } } },
      delegationsChild: { include: { parent: { select: { id: true, name: true } } } },
    },
  });
  if (!agent) notFound();

  const [activity, pendingApprovals, policies, workloadIdentities, connectorMap] = await Promise.all([
    db.auditEvent.findMany({
      where: { environmentId: ctx.environment.id, agentId: agent.id },
      orderBy: { seq: "desc" },
      take: 12,
    }),
    db.approvalRequest.count({ where: { agentId: agent.id, status: "pending" } }),
    db.approvalPolicy.findMany({
      where: { environmentId: ctx.environment.id, OR: [{ agentId: agent.id }, { agentId: null }] },
      orderBy: { agentId: "desc" },
    }),
    db.workloadIdentity.findMany({
      where: { environmentId: ctx.environment.id, agentId: agent.id },
      orderBy: { createdAt: "desc" },
    }),
    loadConnectorMap(ctx.environment.id),
  ]);

  const tags: string[] = JSON.parse(agent.tagsJson || "[]");
  const canManage = ctx.capabilities.manageAgents && (!ctx.isProduction || ctx.capabilities.writeProduction);

  return (
    <div>
      <PageHeader
        eyebrow={`Agents · ${agent.keyMode === "client" ? "client-held key" : "Authab-managed key"}`}
        title={agent.name}
        description={agent.description ?? "No description yet. Add one so approvers know what this agent does."}
        actions={
          <>
            <Link href="/app/agents" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
              All agents
            </Link>
            {ctx.environment.type === "development" && ctx.capabilities.writeProduction ? (
              <Link href={`/app/promote/${agent.id}`} className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
                Promote to production
              </Link>
            ) : null}
          </>
        }
      />

      {query.error ? <Notice kind="error">{STATUS_ERROR[query.error] ?? "That action could not be completed."}</Notice> : null}
      {query.created ? <Notice kind="ok">Agent registered. Its private key is sealed in the vault — issue a token to try it.</Notice> : null}
      {query.saved ? <Notice kind="ok">Agent updated.</Notice> : null}
      {query.rotated ? <Notice kind="ok">A new key pair is active. The previous key stays valid for 7 days.</Notice> : null}
      {query.promoted ? <Notice kind="ok">Promoted to production with safe launch enabled for 7 days.</Notice> : null}
      {query.wi === "created" ? <Notice kind="ok">Workload identity added. The agent can now exchange cluster-issued JWTs for scoped tokens.</Notice> : null}
      {query.wi === "updated" ? <Notice kind="ok">Workload identity updated.</Notice> : null}
      {query.wi === "deleted" ? <Notice kind="ok">Workload identity removed. New exchanges from that issuer are rejected.</Notice> : null}
      {query.wi_error ? <Notice kind="error">{WI_ERROR[query.wi_error] ?? "That workload identity change could not be completed."}</Notice> : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <StatusBadge status={agent.status} />
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">
          {formatFingerprint(agent.fingerprint)}
        </span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">
          {agent.grants.length} grant{agent.grants.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">
          {pendingApprovals ? `${pendingApprovals} pending` : "no pending approvals"}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
              {tag}
            </span>
          ))}
          {agent.autonomousMode ? (
            <span className="border border-[#7a3db8]/35 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#7a3db8]">
              autonomous
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Identity" hint="Public key and fingerprint" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <Row label="Fingerprint" value={formatFingerprint(agent.fingerprint)} mono />
              <Row label="Key mode" value={agent.keyMode === "client" ? "Client-held (BYOK)" : "Authab-managed"} />
              <Row label="Owner" value={agent.owner ? `${agent.owner.name} · ${agent.owner.email}` : "Unassigned"} />
              <Row label="Framework" value={agent.framework ?? "—"} />
              <Row label="Agent type" value={agentTypeLabel(agent.agentType)} />
              <Row label="Created" value={formatDate(agent.createdAt)} />
              <Row label="Last active" value={agent.lastActiveAt ? formatDate(agent.lastActiveAt) : "Never"} />
              {agent.promotedFromAgentId ? (
                <div className="flex items-start justify-between gap-6 px-4 py-2.5">
                  <dt className="text-black/60 dark:text-muted-foreground">Promoted from</dt>
                  <dd className="font-mono text-[11px]">{agent.promotedFromAgentId}</dd>
                </div>
              ) : null}
            </dl>
            <details className="border-t border-black/10 px-4 py-3 dark:border-border">
              <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Public key (PEM)
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto border border-black/10 bg-[#0b0b0b] p-3 text-[10px] leading-relaxed text-[#e8e6e1]">
                {agent.publicKey ?? "No public key on record."}
              </pre>
            </details>
          </Panel>

          <Panel title="Try a token" hint="5-minute EdDSA JWT" bodyClassName="p-4">
            <TokenIssuer agentId={agent.id} keyMode={agent.keyMode} />
            <p className="mt-3 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Tokens are signed with the platform key and verified against{" "}
              <Link href="/.well-known/jwks.json" className="underline">
                /.well-known/jwks.json
              </Link>
              . Revoke any token from the API by its <span className="font-mono">jti</span>.
            </p>
          </Panel>

          <Panel title="Agent credentials" hint="Short-lived tokens without long-lived API keys" bodyClassName="p-4">
            <div className="space-y-6">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Client secrets</p>
                  <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">POST /api/v1/tokens/client-credentials</span>
                </div>
                <p className="mb-3 mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Issue a secret the agent can exchange for a short-lived token. Only a hash is stored, the raw value is shown once,
                  and revocation is immediate.
                </p>
                <AgentClientSecrets
                  agentId={agent.id}
                  canManage={canManage}
                  initialSecrets={agent.clientSecrets.map((secret) => ({
                    id: secret.id,
                    label: secret.label,
                    prefix: secret.prefix,
                    scopes: JSON.parse(secret.scopesJson || "[]") as string[],
                    lastUsedAt: secret.lastUsedAt?.toISOString() ?? null,
                    expiresAt: secret.expiresAt?.toISOString() ?? null,
                    revokedAt: secret.revokedAt?.toISOString() ?? null,
                    createdAt: secret.createdAt.toISOString(),
                  }))}
                />
              </div>

              <div className="border-t border-black/10 pt-4 dark:border-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">Workload identity</p>
                  <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">POST /api/v1/tokens/workload-exchange</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Trust a Kubernetes or SPIFFE issuer, then exchange the workload&apos;s signed JWT for an Authab token. The workload never
                  stores a static secret.
                </p>

                {workloadIdentities.length ? (
                  <div className="mt-3 space-y-2">
                    {workloadIdentities.map((identity) => (
                      <div key={identity.id} className="border border-black/10 px-3 py-2 dark:border-border">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-medium">{identity.name}</span>
                          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">{identity.type}</span>
                          <span
                            className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${
                              identity.enabled
                                ? "border-[#2f6b3d]/35 text-[#2f6b3d]"
                                : "border-black/15 text-black/60 dark:border-border dark:text-muted-foreground"
                            }`}
                          >
                            {identity.enabled ? "enabled" : "disabled"}
                          </span>
                          {canManage ? (
                            <div className="ml-auto flex items-center gap-2">
                              <form action={toggleWorkloadIdentityAction}>
                                <input type="hidden" name="agentId" value={agent.id} />
                                <input type="hidden" name="identityId" value={identity.id} />
                                <input type="hidden" name="enabled" value={identity.enabled ? "0" : "1"} />
                                <button className="font-mono text-[8px] uppercase tracking-[0.1em] underline">
                                  {identity.enabled ? "Disable" : "Enable"}
                                </button>
                              </form>
                              <form action={deleteWorkloadIdentityAction}>
                                <input type="hidden" name="agentId" value={agent.id} />
                                <input type="hidden" name="identityId" value={identity.id} />
                                <ConfirmButton
                                  message={`Remove the ${identity.name} workload identity? New exchanges from this issuer stop immediately.`}
                                  className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#8c3225] dark:text-[#f0a396] underline"
                                >
                                  Remove
                                </ConfirmButton>
                              </form>
                            </div>
                          ) : null}
                        </div>
                        <p className="mt-1 break-all font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          iss {identity.issuer} · aud {identity.audience} · sub {identity.subjectPattern ?? "*"} · ttl{" "}
                          {identity.tokenTtlSeconds}s
                        </p>
                        <p className="mt-0.5 break-all font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                          {identity.jwksUrl ?? "inline JWKS"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-black/60 dark:text-muted-foreground">
                    No workload identity is mapped to this agent.
                  </p>
                )}

                {canManage ? (
                  <details className="mt-3 border border-black/10 px-3 py-2 dark:border-border">
                    <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
                      Add workload identity
                    </summary>
                    <form action={createWorkloadIdentityAction} className="mt-3 space-y-2.5">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Field label="Name" name="name" placeholder="GKE agent" required />
                        <div>
                          <label htmlFor="wi_type" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                            Type
                          </label>
                          <select
                            id="wi_type"
                            name="type"
                            className="mt-1 w-full border border-black/45 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
                          >
                            <option value="spiffe">SPIFFE</option>
                            <option value="kubernetes">Kubernetes</option>
                            <option value="custom">Custom OIDC</option>
                          </select>
                        </div>
                      </div>
                      <Field label="Issuer" name="issuer" placeholder="https://kubernetes.default.svc" required />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Field label="Audience" name="audience" placeholder="authab" required />
                        <Field label="Token TTL (seconds)" name="tokenTtlSeconds" placeholder="300" />
                      </div>
                      <Field label="Subject pattern" name="subjectPattern" placeholder="system:serviceaccount:prod:agent-*" />
                      <Field label="JWKS URL" name="jwksUrl" placeholder="https://issuer.example.com/.well-known/jwks.json" required />
                      <button className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                        Add workload identity
                      </button>
                      <p className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                        The JWKS URL is fetched over HTTPS. Invalid issuer, audience or subject patterns fail closed before any token is issued.
                      </p>
                    </form>
                  </details>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="Grants"
            hint="What this agent may do"
            actions={
              <Link href={`/app/permissions/${agent.id}`} className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                Edit permissions
              </Link>
            }
            bodyClassName="p-0"
          >
            {agent.grants.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {agent.grants.map((grant) => {
                  const def = connectorMap.get(grant.credential.connectorSlug);
                  const actions: string[] = JSON.parse(grant.actionsJson || "[]");
                  return (
                    <div key={grant.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="size-1.5 rounded-full" style={{ background: def?.color ?? "#999" }} />
                        <p className="text-[12px] font-medium">{def?.name ?? grant.credential.connectorSlug}</p>
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                          {grant.credential.name}
                        </span>
                        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                          {grant.approvalMode ?? "policy default"}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {actions.map((action) => (
                          <span key={action} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] text-black/65 dark:border-border dark:text-muted-foreground">
                            {action}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        resource: {grant.resourcePattern}
                        {grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt)}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="font-display text-xl tracking-tight">No grants yet.</p>
                <p className="mt-1 text-[12px] text-black/60 dark:text-muted-foreground">
                  The agent can hold a token, but has no connections to call.
                </p>
                <Link href={`/app/permissions/${agent.id}`} className="mt-3 inline-block border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                  Grant access
                </Link>
              </div>
            )}
          </Panel>

          <Panel title="Recent activity" hint="Calls and decisions" bodyClassName="p-0">
            {activity.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {activity.map((event) => {
                  const payload = JSON.parse(event.payloadSummary || "{}") as { action?: string; resource?: string; risk?: string };
                  return (
                    <div key={event.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <span className="w-14 shrink-0 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {relativeTime(event.timestamp)}
                      </span>
                      <StatusBadge status={event.outcome} />
                      <p className="min-w-0 flex-1 truncate text-[12px]">
                        {actionLabel(event.action)}
                        {payload.action ? <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground"> · {payload.action}</span> : null}
                      </p>
                      {payload.risk ? <RiskBadge risk={payload.risk} /> : null}
                      {payload.resource ? (
                        <span className="hidden max-w-[180px] truncate font-mono text-[9px] text-black/60 dark:text-muted-foreground md:block">
                          {payload.resource}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-6 text-[12px] text-black/60 dark:text-muted-foreground">No activity for this agent yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Controls" hint="Pause, isolate, revoke" bodyClassName="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              {agent.status !== "active" && agent.status !== "revoked" ? (
                <form action={setAgentStatusAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="status" value="active" />
                  <button
                    disabled={!canManage}
                    className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
                  >
                    Resume
                  </button>
                </form>
              ) : (
                <form action={setAgentStatusAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="status" value="paused" />
                  <button
                    disabled={!canManage || agent.status === "revoked"}
                    className="w-full border border-black/20 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black disabled:opacity-40 dark:border-border"
                  >
                    Pause
                  </button>
                </form>
              )}
              <form action={setAgentStatusAction}>
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="status" value="suspended" />
                <button
                  disabled={!canManage || agent.status === "revoked" || agent.status === "suspended"}
                  className="w-full border border-black/20 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black disabled:opacity-40 dark:border-border"
                >
                  Suspend
                </button>
              </form>
            </div>
            <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Paused agents keep their grants but cannot receive tokens. Suspension is louder: every new call is denied and
              surfaced in the activity feed.
            </p>
            <form action={rotateAgentKeyAction}>
              <input type="hidden" name="agentId" value={agent.id} />
              <button
                disabled={!canManage || agent.keyMode === "client"}
                className="w-full border border-black/20 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black disabled:opacity-40 dark:border-border"
              >
                Rotate key
              </button>
            </form>
            <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              The new key takes over immediately. The old key keeps verifying for 7 days so in-flight tokens do not fail
              mid-run.
            </p>
          </Panel>

          <Panel title="Danger zone" hint="Immediate and permanent" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              The kill switch revokes the agent, deletes every grant and retires all keys. In-flight tokens stop working at
              the proxy on the next request.
            </p>
            <form action={killSwitchAction} className="mt-3">
              <input type="hidden" name="agentId" value={agent.id} />
              <ConfirmButton
                message={`Revoke ${agent.name} permanently? Grants and keys are deleted, and this cannot be undone.`}
                className="w-full border border-[#b3402f]/40 bg-[#b3402f]/[0.06] px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8c3225] dark:text-[#f0a396] hover:bg-[#b3402f] hover:text-white disabled:opacity-40"
              >
                Activate kill switch
              </ConfirmButton>
            </form>
          </Panel>

          <Panel title="Policy" hint="Approval rules that touch this agent" bodyClassName="p-0">
            {policies.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {policies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="font-mono text-[11px]">{policy.actionPattern}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        {policy.agentId ? "agent policy" : "environment policy"}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                      {policy.mode}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                No approval policies target this agent. Defaults apply: reads are allowed, everything else needs approval in
                production.
              </p>
            )}
            {agent.safeLaunchUntil && agent.safeLaunchUntil > new Date() ? (
              <p className="border-t border-black/10 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#8a5600] dark:border-border dark:text-[#e8b26a]">
                Safe launch until {formatDate(agent.safeLaunchUntil)}
              </p>
            ) : null}
          </Panel>

          <Panel title="Edit" hint="Metadata and autonomy" bodyClassName="p-4">
            <form action={updateAgentAction} className="space-y-3">
              <input type="hidden" name="agentId" value={agent.id} />
              <div>
                <label htmlFor="description" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={agent.description ?? ""}
                  className="mt-1 w-full resize-none border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
              </div>
              <div>
                <label htmlFor="tags" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Tags
                </label>
                <input
                  id="tags"
                  name="tags"
                  defaultValue={tags.join(", ")}
                  className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
              </div>
              <div>
                <label htmlFor="framework" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Framework
                </label>
                <input
                  id="framework"
                  name="framework"
                  defaultValue={agent.framework ?? ""}
                  className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
              </div>
              <div>
                <label htmlFor="type" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Agent type
                </label>
                <select
                  id="type"
                  name="type"
                  defaultValue={agent.agentType}
                  className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                >
                  {AGENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {agentTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-2 text-[11px] leading-relaxed text-black/65 dark:text-muted-foreground">
                <input type="checkbox" name="autonomousMode" defaultChecked={agent.autonomousMode} className="mt-0.5 size-3.5 accent-black" />
                Autonomous mode — skip approval gates for this agent. Every call is still audited.
              </label>
              <button
                disabled={!canManage}
                className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Save changes
              </button>
            </form>
          </Panel>

          {agent.delegationsParent.length || agent.delegationsChild.length ? (
            <Panel title="Delegation" hint="On-behalf-of chains" bodyClassName="p-4">
              {agent.delegationsParent.map((delegation) => (
                <p key={delegation.id} className="text-[11px] leading-relaxed">
                  May act on behalf of <Link href={`/app/agents/${delegation.child.id}`} className="underline">{delegation.child.name}</Link>{" "}
                  — {delegation.purpose ?? "no purpose recorded"}.
                </p>
              ))}
              {agent.delegationsChild.map((delegation) => (
                <p key={delegation.id} className="mt-2 text-[11px] leading-relaxed">
                  Delegates to <Link href={`/app/agents/${delegation.parent.id}`} className="underline">{delegation.parent.name}</Link>.
                </p>
              ))}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-2.5">
      <dt className="text-black/60 dark:text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={`wi_${name}`} className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={`wi_${name}`}
        name={name}
        placeholder={placeholder}
        required={required}
        spellCheck={false}
        autoComplete="off"
        className="mt-1 w-full border border-black/45 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
      />
    </div>
  );
}
