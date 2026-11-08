import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { PLANS, formatPrice, planFor } from "@/lib/plans";
import { isBillingActive, productionAccess } from "@/lib/limits";
import { priceIdFor, stripeConfigured } from "@/lib/stripe";
import { Notice, PageHeader, Panel } from "@/components/app/ui";
import { requestPlanChangeAction, startCheckoutAction, switchEnvironmentAction } from "@/app/app/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Unlock production" };

const UNLOCKS = [
  {
    title: "A separate production identity",
    detail: "Every agent gets its own Ed25519 key pair for production. Development keys never cross over.",
  },
  {
    title: "Production-only connections",
    detail: "Vault entries are scoped per environment, so live credentials never touch development.",
  },
  {
    title: "Approvals and safe launch",
    detail: "Non-read calls can require a second human. Safe launch enforces approval for the first 7 days.",
  },
  {
    title: "Real traffic and longer history",
    detail: "Proxy live data with a 90-day audit trail on Pro, or a full year on Scale.",
  },
];

export default async function ProductionUpgradePage() {
  const ctx = await getContext();
  const access = productionAccess(ctx.org.plan, ctx.org.planStatus);
  if (access.allowed) redirect("/app");

  const subscribed = planFor(ctx.org.plan);
  const suspended = !isBillingActive(ctx.org.planStatus);
  const currency = ctx.org.billingCurrency === "INR" ? "INR" : "USD";
  const stripeReady = stripeConfigured();
  const subscribedIndex = PLANS.findIndex((plan) => plan.key === subscribed.key);
  const candidates = PLANS.filter(
    (plan) => plan.production && PLANS.findIndex((entry) => entry.key === plan.key) > subscribedIndex,
  );
  const development = ctx.environments.find((env) => env.type === "development");
  const canManageBilling = ctx.capabilities.manageBilling;

  return (
    <div>
      <PageHeader
        eyebrow="Production · plan gate"
        title={suspended ? "Production is paused." : "Production is a paid surface."}
        description={
          suspended
            ? `Billing is ${ctx.org.planStatus}, so production writes stay locked until the subscription is active again. Development keeps working.`
            : `The ${subscribed.name} plan covers development only. Upgrade the workspace to give production its own identity, connections and audit trail.`
        }
        actions={
          development ? (
            <form action={switchEnvironmentAction}>
              <input type="hidden" name="environmentId" value={development.id} />
              <button
                type="submit"
                className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
              >
                Keep building in development
              </button>
            </form>
          ) : null
        }
      />

      {suspended ? (
        <Notice kind="error">
          Subscription status is <strong>{ctx.org.planStatus}</strong>. Production unlocks automatically when Stripe reports the
          subscription is active.{" "}
          <Link href="/app/billing" className="underline underline-offset-2">
            Open billing
          </Link>
          .
        </Notice>
      ) : (
        <Notice kind="ok">
          Development is untouched — your dev agents and grants keep running. Production adds a separate environment with its own
          keys and credentials.
        </Notice>
      )}

      {!canManageBilling ? (
        <Notice kind="error">Only workspace owners and admins can change the plan. Ask one of them to upgrade this workspace.</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <Panel title="What production unlocks" hint="Everything development does, with live stakes" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {UNLOCKS.map((item) => (
                <div key={item.title} className="flex items-start gap-3 px-4 py-3.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center border border-[#eca8d6] bg-[#eca8d6]/20 font-mono text-[9px]">
                    +
                  </span>
                  <div>
                    <p className="text-[12px] font-medium">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Current plan" hint="Where this workspace stands" bodyClassName="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium">{subscribed.name}</p>
                <p className="mt-0.5 max-w-xs text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
                  {suspended ? `Billing ${ctx.org.planStatus}. Paid limits are paused.` : access.message}
                </p>
              </div>
              <Link
                href="/pricing"
                className="border border-black/15 bg-white px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] hover:border-black dark:border-border dark:bg-card"
              >
                Compare plans
              </Link>
            </div>
          </Panel>
        </div>

        <Panel
          title={suspended ? "Restore production" : "Upgrade to unlock production"}
          hint={suspended ? "Billing must be active first" : "Paid plans include production mode"}
          bodyClassName="p-0"
        >
          {suspended ? (
            <div className="px-4 py-5">
              <p className="text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
                {canManageBilling
                  ? "Update the payment method in billing. Production unlocks automatically when Stripe confirms the subscription — usually within seconds."
                  : "A workspace owner needs to update billing before production can be unlocked."}
              </p>
              {canManageBilling ? (
                <Link
                  href="/app/billing"
                  className="mt-4 inline-flex border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
                >
                  Update billing
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-black/10 dark:divide-border">
              {candidates.map((candidate) => {
                const checkoutReady = stripeReady && Boolean(priceIdFor(candidate.key, currency));
                if (candidate.key === "enterprise") {
                  return (
                    <Link
                      key={candidate.key}
                      href="/contact"
                      className="flex items-center gap-3 px-4 py-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">{candidate.name}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
                          Custom volume, retention and procurement.
                        </p>
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/45 dark:text-muted-foreground">
                        Talk to sales →
                      </span>
                    </Link>
                  );
                }
                return (
                  <form key={candidate.key} action={checkoutReady ? startCheckoutAction : requestPlanChangeAction} className="px-4 py-4">
                    <input type="hidden" name="plan" value={candidate.key} />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-medium">{candidate.name}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
                          {candidate.description}
                        </p>
                      </div>
                      {candidate.highlight ? (
                        <span className="border border-[#eca8d6] bg-[#eca8d6]/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em]">
                          Production
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 font-display text-2xl leading-none tracking-tight">
                      {formatPrice(candidate, currency)}
                      <span className="ml-1 font-sans text-[11px] tracking-normal text-black/45 dark:text-muted-foreground">/ month</span>
                    </p>
                    <ul className="mt-3 space-y-1">
                      {candidate.features.slice(0, 3).map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          <span className="mt-1.5 size-1 shrink-0 bg-[#eca8d6]" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {canManageBilling ? (
                      <>
                        <button
                          type="submit"
                          className="mt-4 w-full border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
                        >
                          {checkoutReady ? candidate.cta : `Request ${candidate.name}`}
                        </button>
                        {!checkoutReady ? (
                          <p className="mt-2 text-[10px] text-black/40 dark:text-muted-foreground">
                            Card checkout is not configured here — this sends an upgrade request to billing instead.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-4 border border-dashed border-black/15 px-3 py-2 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-black/40 dark:border-border dark:text-muted-foreground">
                        Owner approval required
                      </p>
                    )}
                  </form>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
