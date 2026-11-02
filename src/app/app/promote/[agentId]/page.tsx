import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { previewPromotion } from "@/lib/promotion";
import { promoteAgentAction } from "@/app/app/actions";
import { connector } from "@/lib/connectors";
import { ConnectorLogo } from "@/components/connector-logo";
import { PageHeader, Panel, Notice, RiskBadge, relativeTime } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Promote agent" };

const ERROR_COPY: Record<string, string> = {
  permission: "Only owners and admins can promote agents to production.",
  environment: "Switch to the development environment to start a promotion.",
};

export default async function PromotePage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const { agentId } = await params;
  const query = await searchParams;

  if (ctx.environment.type !== "development") redirect(`/app/agents/${agentId}`);

  const preview = await previewPromotion(agentId);
  if (!preview.ok) notFound();

  const agent = preview.agent;
  const blocked = !preview.planOk || Boolean(preview.existing) || !ctx.capabilities.writeProduction || !ctx.user.emailVerifiedAt;

  return (
    <div>
      <PageHeader
        eyebrow="Promotion · development → production"
        title={`Ship ${agent.name}.`}
        description="Production gets a new identity, new tokens and the same grants — re-pointed at production connections. The development agent keeps running."
        actions={
          <Link href={`/app/agents/${agent.id}`} className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Back to agent
          </Link>
        }
      />

      {query.error ? (
        <Notice kind="error">{ERROR_COPY[query.error] ?? decodeURIComponent(query.error)}</Notice>
      ) : null}
      {!ctx.user.emailVerifiedAt ? (
        <Notice kind="error">Verify your email before promoting. Promotion is a production write and needs a verified human.</Notice>
      ) : null}
      {!ctx.capabilities.writeProduction ? (
        <Notice kind="error">Your role can prepare this promotion but only owners and admins can confirm it.</Notice>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">Step</span>
        {[
          { n: "01", label: "Readiness" },
          { n: "02", label: "Diff" },
          { n: "03", label: "Confirm" },
        ].map((step, index) => (
          <span key={step.n} className="flex items-center gap-1.5">
            <span className={`flex size-5 items-center justify-center border font-mono text-[8px] ${index === 0 ? "border-black bg-black text-white dark:border-foreground dark:bg-foreground dark:text-background" : "border-black/15 text-black/40 dark:border-border dark:text-muted-foreground"}`}>
              {step.n}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em]">{step.label}</span>
            {index < 2 ? <span className="text-black/20">→</span> : null}
          </span>
        ))}
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
          target: production
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Readiness" hint="Warnings do not block; failures do" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {preview.readiness.map((check) => (
                <div key={check.label} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border font-mono text-[9px] ${
                      check.level === "pass"
                        ? "border-[#2f7d5c]/40 bg-[#2f7d5c]/[0.08] text-[#2f7d5c]"
                        : check.level === "warn"
                          ? "border-[#a56b18]/40 bg-[#a56b18]/[0.08] text-[#8c5a12]"
                          : "border-[#b3402f]/40 bg-[#b3402f]/[0.08] text-[#8c3225]"
                    }`}
                  >
                    {check.level === "pass" ? "✓" : check.level === "warn" ? "!" : "×"}
                  </span>
                  <div>
                    <p className="text-[12px] font-medium">{check.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Grant diff" hint="Development → production connections" bodyClassName="p-0">
            {preview.diff.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {preview.diff.map((row) => {
                  const def = connector(row.connector);
                  return (
                    <div key={`${row.connector}-${row.credentialName}`} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex size-6 items-center justify-center text-white" style={{ background: def?.color ?? "#333" }}>
                          <ConnectorLogo slug={row.connector} mark={def?.mark} mono className="size-3.5" />
                        </span>
                        <span className="text-[12px] font-medium">{def?.name ?? row.connector}</span>
                        <span className="font-mono text-[9px] text-black/40 dark:text-muted-foreground">{row.credentialName}</span>
                        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.1em]">
                          {row.granted ? (
                            <span className="text-[#2f7d5c]">→ {row.productionCredentialName}</span>
                          ) : (
                            <span className="text-[#8c3225]">skipped · no production connection</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {row.actions.map((action) => (
                          <span key={action} className="border border-black/10 px-1.5 py-0.5 font-mono text-[9px] text-black/55 dark:border-border dark:text-muted-foreground">
                            {action}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 font-mono text-[9px] text-black/35 dark:text-muted-foreground">
                        resource {row.resourcePattern} · {row.approvalMode ?? "policy default"}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-5 text-[11px] text-black/45 dark:text-muted-foreground">
                This agent has no grants. It will be created in production with no access.
              </p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="What changes" hint="Identity and environment" bodyClassName="p-4">
            <dl className="space-y-2.5 text-[11px] leading-relaxed">
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">Identity</dt>
                <dd className="mt-0.5">A fresh Ed25519 key pair and fingerprint. The development identity never reaches production.</dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">Credentials</dt>
                <dd className="mt-0.5">Production connections are used, not the development ones. Missing services are skipped, not copied.</dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">Approval</dt>
                <dd className="mt-0.5">Safe launch forces approval for every non-read call for 7 days, even where the grant says allow.</dd>
              </div>
              <div>
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">Audit</dt>
                <dd className="mt-0.5">The promotion is written to both trails with a link back to the development agent.</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Safe launch" hint="On by default" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
              For the first seven days, production traffic that writes, destroys or moves money requires a human. Reads run
              normally. You can lift the restriction afterwards by changing the grant approval mode.
            </p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8c5a12]">
              {relativeTime(new Date(Date.now() + 7 * 86400_000))} · automatic
            </p>
          </Panel>

          <Panel title="Confirm" hint="Cannot be undone" bodyClassName="p-4">
            {preview.existing ? (
              <p className="text-[12px] leading-relaxed text-black/55 dark:text-muted-foreground">
                This agent already exists in production as <strong>{preview.existing.name}</strong>. A second promotion creates a
                duplicate; delete or rename the production agent first if you are re-shipping.
              </p>
            ) : (
              <form action={promoteAgentAction} className="space-y-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <label className="flex items-start gap-2 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
                  <input type="checkbox" required className="mt-0.5 size-3.5 accent-black" />
                  I reviewed the readiness checks and the production grant diff.
                </label>
                <button
                  disabled={blocked}
                  className="w-full border border-black bg-black px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
                >
                  Promote to production
                </button>
                <p className="text-[10px] leading-relaxed text-black/40 dark:text-muted-foreground">
                  {blocked
                    ? "Resolve the blocked checks above before promoting."
                    : "You will be switched to production and shown the new agent."}
                </p>
              </form>
            )}
          </Panel>

          <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-black/40 dark:text-muted-foreground">
              <RiskBadge risk="write" /> production change
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
              Promotions are audited as <span className="font-mono">promotion.completed</span> with the readiness verdict and the
              grant diff attached.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
