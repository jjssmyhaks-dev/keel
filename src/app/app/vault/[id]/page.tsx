import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { connector, actionFor } from "@/lib/connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { rotateCredentialAction, revokeCredentialAction } from "@/app/app/actions";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader, Panel, StatusBadge, RiskBadge, Notice, relativeTime, formatDate, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Connection" };

const ERROR_COPY: Record<string, string> = {
  permission: "Your role cannot change connections in this environment.",
  production: "Only owners and admins can change production connections.",
  missing: "That connection no longer exists.",
  secret: "Paste a new secret before rotating.",
  revoked: "This connection was revoked. Create a new one instead of rotating it.",
};

export default async function CredentialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { id } = await params;
  const query = await searchParams;

  const credential = await db.credential.findFirst({
    where: { id, environmentId: ctx.environment.id },
    include: {
      grants: { include: { agent: { select: { id: true, name: true, status: true } } } },
      healthEvents: { orderBy: { checkedAt: "desc" }, take: 10 },
    },
  });
  if (!credential) notFound();

  const def = connector(credential.connectorSlug);
  const metadata = (() => {
    try {
      return JSON.parse(credential.metadataJson || "{}") as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const canManage = ctx.capabilities.manageCredentials;
  const revoked = Boolean(credential.revokedAt);

  const recentCalls = await db.auditEvent.findMany({
    where: {
      environmentId: ctx.environment.id,
      action: "proxy.call",
      OR: [
        { payloadSummary: { contains: credential.id } },
        ...(credential.grants.length
          ? [
              {
                resourceType: { in: ["connector", "connection"] },
                resourceId: credential.connectorSlug,
                agentId: { in: credential.grants.map((grant) => grant.agent.id) },
              },
            ]
          : []),
      ],
    },
    orderBy: { seq: "desc" },
    take: 6,
  });

  return (
    <div>
      <PageHeader
        eyebrow={`Vault · ${def?.name ?? credential.connectorSlug}`}
        title={credential.name}
        description={def?.description ?? "A connection in this environment."}
        actions={
          <Link href="/app/vault" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Back to vault
          </Link>
        }
      />

      {query.error ? <Notice kind="error">{ERROR_COPY[query.error] ?? "That action could not be completed."}</Notice> : null}
      {query.created ? <Notice kind="ok">Connection sealed and stored. Grant it to an agent from the permission matrix.</Notice> : null}
      {query.rotated ? <Notice kind="ok">Secret rotated. Existing grants keep working with the new credential.</Notice> : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <span
          className="flex size-7 items-center justify-center text-white"
          style={{ background: def?.color ?? "#333" }}
        >
          <ConnectorLogo slug={credential.connectorSlug} mark={def?.mark} mono className="size-4" />
        </span>
        <StatusBadge status={revoked ? "revoked" : credential.status} />
        <span className="font-mono text-[10px] text-black/40 dark:text-muted-foreground">{credential.maskedHint || "••••"}</span>
        <span className="font-mono text-[10px] text-black/30 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-black/40 dark:text-muted-foreground">
          {credential.type.replace("_", " ")}
        </span>
        <span className="font-mono text-[10px] text-black/30 dark:text-muted-foreground">·</span>
        <span className="font-mono text-[10px] text-black/40 dark:text-muted-foreground">
          {credential.lastUsedAt ? `last used ${relativeTime(credential.lastUsedAt)}` : "never used"}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Credential" hint="Metadata only — the secret is never shown" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <Row label="Service" value={def?.name ?? credential.connectorSlug} />
              <Row label="Authentication" value={credential.type.replace("_", " ")} />
              <Row label="Masked hint" value={credential.maskedHint || "—"} mono />
              <Row label="Status" value={revoked ? "Revoked" : credential.status} />
              <Row label="Expires" value={credential.expiresAt ? formatDate(credential.expiresAt) : "No expiry"} />
              <Row label="Created" value={formatDate(credential.createdAt)} />
              <Row label="Last used" value={credential.lastUsedAt ? formatDate(credential.lastUsedAt) : "Never"} />
            </dl>
            <div className="border-t border-black/10 px-4 py-3 dark:border-border">
              <details>
                <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">
                  Encrypted envelope
                </summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/35 dark:text-muted-foreground">Ciphertext</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-black/60 dark:text-muted-foreground">{credential.encryptedPayload ? `${credential.encryptedPayload.slice(0, 120)}…` : "Destroyed on revocation"}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/35 dark:text-muted-foreground">Wrapped data key</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-black/60 dark:text-muted-foreground">{credential.dataKeyEncrypted ? `${credential.dataKeyEncrypted.slice(0, 120)}…` : "Destroyed on revocation"}</p>
                  </div>
                </div>
              </details>
            </div>
          </Panel>

          <Panel
            title="Grants"
            hint="Agents that can use this connection"
            actions={
              <Link href="/app/permissions" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
                Permission matrix
              </Link>
            }
            bodyClassName="p-0"
          >
            {credential.grants.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {credential.grants.map((grant) => {
                  const actions = JSON.parse(grant.actionsJson || "[]") as string[];
                  return (
                    <div key={grant.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/app/agents/${grant.agent.id}`} className="text-[12px] font-medium underline-offset-2 hover:underline">
                          {grant.agent.name}
                        </Link>
                        <StatusBadge status={grant.agent.status} />
                        <Link href={`/app/permissions/${grant.agentId}`} className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-black/45 underline dark:text-muted-foreground">
                          Edit
                        </Link>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {actions.map((action) => {
                          const actionDef = actionFor(credential.connectorSlug, action);
                          return (
                            <span key={action} className="inline-flex items-center gap-1 border border-black/10 px-1.5 py-0.5 font-mono text-[9px] text-black/55 dark:border-border dark:text-muted-foreground">
                              {action}
                              {actionDef ? <RiskBadge risk={actionDef.risk} /> : null}
                            </span>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 font-mono text-[9px] text-black/35 dark:text-muted-foreground">
                        resource: {grant.resourcePattern} · {grant.approvalMode ?? "policy default"}
                        {grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt)}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="font-display text-xl tracking-tight">No agent can use this yet.</p>
                <p className="mt-1 text-[12px] text-black/45 dark:text-muted-foreground">
                  A stored secret grants nothing by itself. Add a grant so the proxy can inject it.
                </p>
                <Link href="/app/permissions" className="mt-3 inline-block border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                  Open permission matrix
                </Link>
              </div>
            )}
          </Panel>

          <Panel title="Recent proxied calls" hint="Last six calls through this connection" bodyClassName="p-0">
            {recentCalls.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {recentCalls.map((event) => {
                  const payload = JSON.parse(event.payloadSummary || "{}") as { action?: string; risk?: string; resource?: string };
                  return (
                    <div key={event.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <span className="w-14 shrink-0 font-mono text-[9px] text-black/35 dark:text-muted-foreground">{relativeTime(event.timestamp)}</span>
                      <StatusBadge status={event.outcome} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{payload.action ?? "proxy call"}</span>
                      {payload.risk ? <RiskBadge risk={payload.risk} /> : null}
                      <span className="font-mono text-[9px] text-black/30 dark:text-muted-foreground">#{event.seq}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-6 text-[12px] text-black/45 dark:text-muted-foreground">No proxied calls through this connection yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Rotate secret" hint="Replace without breaking grants" bodyClassName="p-4">
            <form action={rotateCredentialAction} className="space-y-3">
              <input type="hidden" name="credentialId" value={credential.id} />
              {def?.credentialFields?.length ? (
                def.credentialFields.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`rotate_${field.key}`}
                      className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground"
                    >
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    {field.multiline ? (
                      <textarea
                        id={`rotate_${field.key}`}
                        name={`field_${field.key}`}
                        rows={3}
                        placeholder="Leave blank to keep current"
                        spellCheck={false}
                        autoComplete="off"
                        className="mt-1 w-full resize-none border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                      />
                    ) : (
                      <input
                        id={`rotate_${field.key}`}
                        name={`field_${field.key}`}
                        type={field.secret ? "password" : "text"}
                        placeholder="Leave blank to keep current"
                        spellCheck={false}
                        autoComplete="off"
                        className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                      />
                    )}
                  </div>
                ))
              ) : (
                <textarea
                  name="secret"
                  required
                  rows={3}
                  placeholder="Paste the replacement credential"
                  spellCheck={false}
                  className="w-full resize-none border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
              )}
              <button
                disabled={!canManage || revoked}
                className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Rotate secret
              </button>
            </form>
            <p className="mt-2 text-[11px] leading-relaxed text-black/45 dark:text-muted-foreground">
              The old ciphertext is overwritten immediately. Grants and agent identities are untouched.
            </p>
          </Panel>

          <Panel title="Health history" hint="Stored and latest checks" bodyClassName="p-0">
            {credential.healthEvents.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {credential.healthEvents.map((event) => (
                  <div key={event.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge status={event.result === "ok" ? "healthy" : event.result === "warn" ? "expiring" : "broken"} />
                      <span className="font-mono text-[9px] text-black/35 dark:text-muted-foreground">{relativeTime(event.checkedAt)}</span>
                    </div>
                    {event.detail ? <p className="mt-1 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">{event.detail}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-5 text-[11px] text-black/45 dark:text-muted-foreground">No health checks recorded.</p>
            )}
          </Panel>

          {Object.keys(metadata).length ? (
            <Panel title="Metadata" hint="Non-secret fields" bodyClassName="p-0">
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <dt className="font-mono text-[10px] text-black/45 dark:text-muted-foreground">{key}</dt>
                    <dd className="text-right font-mono text-[10px]">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}

          <Panel title="Danger zone" hint="Revoke this connection" bodyClassName="p-4">
            {revoked ? (
              <EmptyState title="Already revoked" description="This connection can no longer be used by the proxy." />
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-black/45 dark:text-muted-foreground">
                  Revoking marks the secret unusable. Any call that resolves to this connection is denied and audited. Grants are
                  kept on record so the decision is visible in history.
                </p>
                <form action={revokeCredentialAction} className="mt-3">
                  <input type="hidden" name="credentialId" value={credential.id} />
                  <ConfirmButton
                    message={`Revoke ${credential.name}? Agents calling it will be denied immediately.`}
                    className="w-full border border-[#b3402f]/40 bg-[#b3402f]/[0.06] px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8c3225] hover:bg-[#b3402f] hover:text-white disabled:opacity-40"
                  >
                    Revoke connection
                  </ConfirmButton>
                </form>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-2.5">
      <dt className="text-black/45 dark:text-muted-foreground">{label}</dt>
      <dd className={`text-right capitalize ${mono ? "font-mono text-[11px] normal-case" : ""}`}>{value}</dd>
    </div>
  );
}
