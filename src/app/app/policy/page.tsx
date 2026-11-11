import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { simulatePolicy } from "@/lib/policy";
import { PageHeader, Panel, Notice, RiskBadge, EmptyState } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Policy lab" };

const EFFECT_STYLE: Record<string, { label: string; classes: string }> = {
  allow: { label: "Allowed", classes: "border-[#2f7d5c]/35 bg-[#2f7d5c]/[0.07] text-[#245f47]" },
  require_approval: { label: "Needs approval", classes: "border-[#a56b18]/35 bg-[#a56b18]/[0.07] text-[#8c5a12]" },
  deny: { label: "Denied", classes: "border-[#b3402f]/35 bg-[#b3402f]/[0.07] text-[#8c3225]" },
};

export default async function PolicyLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;

  const [agents, credentials, policies, connectorMap] = await Promise.all([
    db.agent.findMany({
      where: { environmentId: ctx.environment.id },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    db.credential.findMany({
      where: { environmentId: ctx.environment.id, revokedAt: null },
      select: { id: true, name: true, connectorSlug: true, maskedHint: true },
      orderBy: { connectorSlug: "asc" },
    }),
    db.approvalPolicy.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: [{ agentId: "desc" }, { actionPattern: "asc" }],
      include: { agent: { select: { name: true } } },
    }),
    loadConnectorMap(ctx.environment.id),
  ]);

  const selectedAgentId = query.agentId ?? "";
  const selectedCredentialId = query.credentialId ?? "";
  const selectedCredential = credentials.find((credential) => credential.id === selectedCredentialId);
  const def = selectedCredential ? connectorMap.get(selectedCredential.connectorSlug) : undefined;
  const actionOptions = def?.actions ?? [];

  let simulation: Awaited<ReturnType<typeof simulatePolicy>> = null;
  let inputError: string | null = null;

  if (selectedAgentId && selectedCredentialId && query.action) {
    let input: Record<string, unknown> | undefined;
    if (query.inputJson?.trim() && query.inputJson.trim() !== "{}") {
      try {
        const parsed = JSON.parse(query.inputJson) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          inputError = "Input must be a JSON object, for example {\"amount\": 250}.";
        } else {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        inputError = "Input is not valid JSON. Amount and other conditions are read from this object.";
      }
    }
    let now: Date | undefined;
    if (query.at?.trim()) {
      const parsed = new Date(query.at.trim());
      if (Number.isNaN(parsed.getTime())) inputError = "Time must be an ISO timestamp, for example 2026-11-11T09:30:00Z.";
      else now = parsed;
    }
    if (!inputError) {
      simulation = await simulatePolicy({
        environment: ctx.environment,
        agentId: selectedAgentId,
        credentialId: selectedCredentialId,
        actionName: query.action,
        resource: query.resource?.trim() || undefined,
        input,
        ip: query.ip?.trim() || null,
        now,
      });
    }
  }

  const decision = simulation?.decision ?? null;
  const effect = decision ? (EFFECT_STYLE[decision.effect] ?? EFFECT_STYLE.deny) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Policy lab · dry run"
        title="Test the rule before the agent does."
        description="Evaluate a call against the live policy engine without touching the provider. Conditions, autonomous mode, just-in-time grants and approval routing all resolve exactly as they would at call time."
        actions={
          <Link href="/app/permissions" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Grants
          </Link>
        }
      />

      {inputError ? <Notice kind="error">{inputError}</Notice> : null}
      {!simulation?.decision && selectedAgentId && selectedCredentialId && query.action && !inputError ? (
        <Notice kind="error">That agent or connection no longer exists in this environment.</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Simulate a call" hint="No provider request is sent" bodyClassName="p-4">
            <form method="GET" action="/app/policy" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="agentId" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Agent
                  </label>
                  <select
                    id="agentId"
                    name="agentId"
                    required
                    defaultValue={selectedAgentId}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
                  >
                    <option value="">Select an agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} · {agent.status}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="credentialId" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Connection
                  </label>
                  <select
                    id="credentialId"
                    name="credentialId"
                    required
                    defaultValue={selectedCredentialId}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
                  >
                    <option value="">Select a connection</option>
                    {credentials.map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {connectorMap.get(credential.connectorSlug)?.name ?? credential.connectorSlug} · {credential.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="action" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Action
                  </label>
                  <input
                    id="action"
                    name="action"
                    required
                    list="policy-actions"
                    defaultValue={query.action ?? ""}
                    placeholder={actionOptions[0]?.name ?? "stripe.create_refund"}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                  <datalist id="policy-actions">
                    {actionOptions.map((action) => (
                      <option key={action.name} value={action.name}>
                        {action.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="resource" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Resource <span className="normal-case tracking-normal text-black/30 dark:text-muted-foreground">optional</span>
                  </label>
                  <input
                    id="resource"
                    name="resource"
                    defaultValue={query.resource ?? ""}
                    placeholder={def?.resourcePlaceholder ?? "customer:cus_123"}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ip" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Caller IP <span className="normal-case tracking-normal text-black/30 dark:text-muted-foreground">for IP conditions</span>
                  </label>
                  <input
                    id="ip"
                    name="ip"
                    defaultValue={query.ip ?? ""}
                    placeholder="203.0.113.42"
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="at" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Evaluate at <span className="normal-case tracking-normal text-black/30 dark:text-muted-foreground">ISO, optional</span>
                  </label>
                  <input
                    id="at"
                    name="at"
                    defaultValue={query.at ?? ""}
                    placeholder="2026-11-11T09:30:00Z"
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="inputJson" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                  Tool input <span className="normal-case tracking-normal text-black/30 dark:text-muted-foreground">JSON for amount conditions</span>
                </label>
                <textarea
                  id="inputJson"
                  name="inputJson"
                  rows={4}
                  defaultValue={query.inputJson ?? ""}
                  placeholder={'{\n  "amount": 250,\n  "currency": "usd"\n}'}
                  className="mt-1 w-full resize-y border border-black/15 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-3 dark:border-border">
                <button
                  type="submit"
                  className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black"
                >
                  Simulate decision
                </button>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:text-muted-foreground">
                  reads live grants, policies and agent state
                </p>
              </div>
            </form>
          </Panel>

          {decision ? (
            <Panel title="Decision" hint="Same engine the proxy runs at call time" bodyClassName="p-0">
              <div className="flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-3 dark:border-border">
                <span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${effect?.classes}`}>
                  {effect?.label}
                </span>
                <RiskBadge risk={decision.risk} />
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:text-muted-foreground">
                  source {decision.source}
                </span>
                {decision.action ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:text-muted-foreground">
                    · {decision.action.name} · {decision.action.method}
                  </span>
                ) : null}
              </div>
              <div className="border-b border-black/10 px-4 py-3 dark:border-border">
                <p className="text-[12px] leading-relaxed text-black/70 dark:text-muted-foreground">{decision.reason}</p>
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/40 dark:text-muted-foreground">
                  {decision.effect === "allow"
                    ? "The proxy would call the provider now."
                    : decision.effect === "require_approval"
                      ? "The proxy would create an approval request and wait."
                      : "The proxy would reject this call with a policy denial."}
                </p>
              </div>
              <div className="divide-y divide-black/10 dark:divide-border">
                {(decision.trace ?? []).map((step, index) => (
                  <div key={`${step.check}-${index}`} className="flex items-start gap-3 px-4 py-2">
                    <span
                      className={`mt-0.5 border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] ${
                        step.outcome === "pass"
                          ? "border-[#2f7d5c]/30 text-[#245f47]"
                          : step.outcome === "fail"
                            ? "border-[#b3402f]/35 text-[#8c3225]"
                            : "border-black/15 text-black/35 dark:border-border dark:text-muted-foreground"
                      }`}
                    >
                      {step.outcome}
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px]">{step.check}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel title="Policy in force" hint="Most specific grant wins" bodyClassName="p-0">
            {policies.length ? (
              <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
                {policies.map((policy) => (
                  <div key={policy.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px]">{policy.actionPattern}</span>
                      <span className="border border-black/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-black/45 dark:border-border dark:text-muted-foreground">
                        {policy.mode}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:text-muted-foreground">
                      {policy.agent?.name ?? "environment default"}
                      {policy.slaMinutes ? ` · SLA ${policy.slaMinutes}m` : ""}
                      {policy.escalateToRole ? ` · escalate to ${policy.escalateToRole}` : ""}
                    </p>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState
                title="No approval policies yet."
                description="Everything falls back to the risk default: read actions allow, writes wait for a human, destructive actions deny."
                action={
                  <Link href="/app/security" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                    Approval settings
                  </Link>
                }
              />
            )}
          </Panel>

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">What gets checked</p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
              <li>Agent status, credential state and connector action allowlist</li>
              <li>Grant pattern, action list, approval mode and expiry</li>
              <li>Just-in-time grants stay denied until activated</li>
              <li>IP allowlists, time windows and amount ceilings are fail-closed</li>
              <li>Approval policies route the call; SLA decides when to escalate</li>
            </ul>
            <p className="mt-3 border-t border-black/10 pt-2 text-[10px] leading-relaxed text-black/35 dark:border-border dark:text-muted-foreground">
              Simulation is read-only: no approval request is created, no audit event is chained, no provider is contacted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
