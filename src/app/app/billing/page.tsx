import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { PLANS, formatPrice, planFor } from "@/lib/plans";
import { effectivePlan, isBillingActive } from "@/lib/limits";
import { periodKey } from "@/lib/proxy";
import { priceIdFor, stripeConfigured } from "@/lib/stripe";
import { PageHeader, Panel, Stat, Notice, StatusBadge, formatDate } from "@/components/app/ui";
import { openBillingPortalAction, requestPlanChangeAction, startCheckoutAction } from "@/app/app/actions";
import {
  DUNNING_GRACE_DAYS,
  TRIAL_DAYS,
  billingAddressLines,
  daysUntil,
  invoiceDisplayStatus,
  parseBillingAddress,
  trialEligible,
} from "@/lib/billing-rules";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Billing" };

function meter(used: number, limit: number) {
  if (limit < 0) return { pct: 0, label: "Unlimited", tone: "text-[#276a4e] dark:text-[#7fd1ab]" };
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return {
    pct,
    label: `${used.toLocaleString("en-IN")} / ${limit.toLocaleString("en-IN")}`,
    tone: pct >= 90 ? "text-[#8c3225] dark:text-[#f0a396]" : pct >= 70 ? "text-[#8c5a12] dark:text-[#e8b26a]" : "text-black/60 dark:text-muted-foreground",
  };
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const subscribed = planFor(ctx.org.plan);
  const billingActive = isBillingActive(ctx.org.planStatus);
  const plan = effectivePlan(ctx.org.plan, ctx.org.planStatus);
  const currency = ctx.org.billingCurrency === "INR" ? "INR" : "USD";
  const period = periodKey();
  const stripeReady = stripeConfigured();
  const trialDays = daysUntil(ctx.org.trialEndsAt);
  const canTrial = trialEligible(ctx.org);
  const trialOffered =
    canTrial && stripeReady && ["pro", "scale"].some((key) => Boolean(priceIdFor(key, currency)));
  const address = parseBillingAddress(ctx.org.billingAddressJson);
  const dunningDays = ctx.org.dunningStartedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(ctx.org.dunningStartedAt).getTime()) / 86_400_000))
    : 0;

  const [usage, invoices, agentCount, credentialCount] = await Promise.all([
    db.usageRecord.findMany({
      where: { orgId: ctx.org.id, metric: "proxy_calls" },
      orderBy: { period: "desc" },
      take: 12,
    }),
    db.invoice.findMany({ where: { orgId: ctx.org.id }, orderBy: { issuedAt: "desc" }, take: 12 }),
    db.agent.count({ where: { environment: { project: { orgId: ctx.org.id } } } }),
    db.credential.count({ where: { environment: { project: { orgId: ctx.org.id } }, revokedAt: null } }),
  ]);
  const usageHistory = usage.slice(0, 6);

  const callsThisMonth = usage.find((record) => record.period === period)?.quantity ?? 0;
  const callsMeter = meter(callsThisMonth, plan.limits.callsPerMonth);
  const agentMeter = meter(agentCount, plan.limits.agents);
  const credentialMeter = meter(credentialCount, plan.limits.credentials);

  const upgradePlans = PLANS.filter(
    (candidate) => PLANS.findIndex((entry) => entry.key === candidate.key) > PLANS.findIndex((entry) => entry.key === subscribed.key),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Billing · plan and usage"
        title={`${subscribed.name} plan · ${currency} billing.`}
        description="Usage is metered per calendar month. Calls that are denied before execution do not count against the allowance."
        actions={
          <Link href="/pricing" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
            Compare plans
          </Link>
        }
      />

      {query.checkout === "success" ? (
        <Notice kind="ok">
          Stripe checkout completed. The new plan activates when Stripe confirms the subscription — usually within seconds.
        </Notice>
      ) : null}
      {query.checkout === "cancelled" ? (
        <Notice kind="error">Checkout was cancelled. The current plan is unchanged.</Notice>
      ) : null}
      {query.error ? (
        <Notice kind="error">
          {query.error === "permission"
            ? "Only the workspace owner can manage billing."
            : query.error === "stripe"
              ? "Stripe could not be reached. Try again, or request the change by email below."
              : query.error === "price"
                ? "No Stripe price is configured for this plan and currency yet."
                : query.error === "subscription"
                  ? "This workspace has no Stripe subscription yet. Start a checkout first."
                  : "That plan is not available for this workspace."}
        </Notice>
      ) : null}
      {query.requested ? (
        <Notice kind="ok">
          Plan change requested. Billing will follow up — the current plan stays active until then.
        </Notice>
      ) : null}
      {ctx.org.planStatus === "trialing" ? (
        <Notice kind="info">
          Trial active{trialDays !== null ? ` — ${trialDays} ${trialDays === 1 ? "day" : "days"} left` : ""}
          {ctx.org.trialEndsAt ? ` (ends ${formatDate(ctx.org.trialEndsAt)})` : ""}. Add a payment method before the trial
          ends to keep paid limits.
        </Notice>
      ) : null}
      {!billingActive ? (
        <Notice kind="error">
          {ctx.org.planStatus === "past_due" ? (
            <>
              Payment failed{dunningDays > 0 ? ` ${dunningDays} ${dunningDays === 1 ? "day" : "days"} ago` : ""}. Stripe is
              retrying automatically for {DUNNING_GRACE_DAYS} days; after that the workspace moves to Free limits. Update the
              payment method to restore paid features.
            </>
          ) : ctx.org.planStatus === "unpaid" ? (
            <>
              Billing is suspended after {DUNNING_GRACE_DAYS} days of failed payments. Free limits apply and production
              writes are disabled until Stripe collects an open invoice.
            </>
          ) : (
            <>
              Subscription status is <strong>{ctx.org.planStatus}</strong>. Free limits apply and production writes are
              disabled until Stripe reports the subscription is active again.
            </>
          )}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Plan"
          value={subscribed.name}
          detail={
            billingActive
              ? ctx.org.planStatus === "trialing" && trialDays !== null
                ? `Trial · ${trialDays} of ${TRIAL_DAYS} days left`
                : `${formatPrice(subscribed, currency)} / month`
              : `Billing ${ctx.org.planStatus} · ${plan.name} limits`
          }
          accent
        />
        <Stat label="Proxy calls" value={callsThisMonth.toLocaleString("en-IN")} detail={callsMeter.label} />
        <Stat label="Agents" value={agentCount} detail={agentMeter.label} />
        <Stat label="Connections" value={credentialCount} detail={credentialMeter.label} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel
            title="This billing period"
            hint={period}
            bodyClassName="p-4"
            actions={
              <a
                href="/app/billing/usage"
                className="border border-black/45 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-black/65 hover:border-black hover:text-black dark:border-white/40 dark:text-muted-foreground dark:hover:text-foreground"
              >
                Usage CSV ↓
              </a>
            }
          >
            <div className="space-y-4">
              {[
                { label: "Proxy calls", used: callsThisMonth, limit: plan.limits.callsPerMonth, meter: callsMeter },
                { label: "Active agents", used: agentCount, limit: plan.limits.agents, meter: agentMeter },
                { label: "Stored connections", used: credentialCount, limit: plan.limits.credentials, meter: credentialMeter },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px]">{row.label}</p>
                    <p className={`font-mono text-[10px] ${row.meter.tone}`}>{row.meter.label}</p>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden bg-black/10 dark:bg-white/10">
                    <div
                      className={`h-full ${row.meter.pct >= 90 ? "bg-[#b3402f]" : row.meter.pct >= 70 ? "bg-[#a56b18]" : "bg-black dark:bg-foreground"}`}
                      style={{ width: row.limit < 0 ? "8%" : `${Math.max(row.meter.pct, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {plan.limits.callsPerMonth > 0 && callsThisMonth > plan.limits.callsPerMonth ? (
              <p className="mt-4 border-t border-black/10 pt-3 text-[11px] leading-relaxed text-[#8c3225] dark:text-[#f0a396] dark:border-border">
                This workspace is over its monthly call allowance. New proxy calls are refused until the period resets or the
                plan changes. Nothing is billed automatically.
              </p>
            ) : null}
            {plan.limits.callsPerMonth > 0 ? (
              <p className="mt-4 border-t border-black/10 pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:border-border dark:text-muted-foreground">
                Allowances reset on the first of each month · extra usage is refused, not billed
              </p>
            ) : null}
            {usageHistory.length ? (
              <div className="mt-4 border-t border-black/10 pt-3 dark:border-border">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
                  Usage history
                </p>
                <div className="mt-2 space-y-1.5">
                  {usageHistory.map((record) => {
                    const over = plan.limits.callsPerMonth >= 0 && record.quantity > plan.limits.callsPerMonth;
                    return (
                      <div key={record.id} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px]">{record.period}</span>
                        <span
                          className={`font-mono text-[10px] ${
                            over ? "text-[#8c3225] dark:text-[#f0a396]" : "text-black/60 dark:text-muted-foreground"
                          }`}
                        >
                          {record.quantity.toLocaleString("en-IN")} calls{over ? " · over allowance" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  The CSV statement covers the last 12 periods and is a usage record, not a tax invoice.
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Invoices" hint="Paid and open" bodyClassName="p-0">
            {invoices.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {invoices.map((invoice) => {
                  const display = invoiceDisplayStatus(invoice.status);
                  return (
                    <div key={invoice.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="font-mono text-[11px]">{invoice.number}</span>
                      <span className="text-[11px] text-black/60 dark:text-muted-foreground">
                        {formatDate(invoice.issuedAt)}
                        {invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ""}
                      </span>
                      <span className="ml-auto font-mono text-[11px]">
                        {invoice.currency === "INR"
                          ? `₹${(invoice.amount / 100).toLocaleString("en-IN")}`
                          : `$${(invoice.amount / 100).toFixed(2)}`}
                      </span>
                      {invoice.hostedUrl ? (
                        <a
                          href={invoice.hostedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 underline-offset-2 hover:text-black hover:underline dark:text-muted-foreground dark:hover:text-foreground"
                        >
                          Hosted ↗
                        </a>
                      ) : null}
                      {invoice.pdfUrl ? (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 underline-offset-2 hover:text-black hover:underline dark:text-muted-foreground dark:hover:text-foreground"
                        >
                          PDF
                        </a>
                      ) : null}
                      <StatusBadge status={display.badge} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-6 text-[12px] text-black/60 dark:text-muted-foreground">
                No invoices yet. The {subscribed.name} plan has no charge on file{subscribed.priceUsd === 0 ? " — it is free." : "."}
              </p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Plan includes" hint={billingActive ? plan.description : "Free limits while billing is suspended"} bodyClassName="p-4">
            <ul className="space-y-1.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-[12px] leading-relaxed">
                  <span className="mt-1.5 size-1 shrink-0 bg-[#eca8d6]" />
                  {feature}
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-black/10 pt-3 dark:border-border">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">Retention</p>
              <p className="mt-0.5 text-[12px]">{plan.limits.retentionDays.toLocaleString("en-IN")} days of audit history</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">Seats</p>
              <p className="mt-0.5 text-[12px]">{plan.limits.members < 0 ? "Unlimited members" : `${plan.limits.members} members`}</p>
            </div>
          </Panel>

          <Panel title="Billing contact" hint="Where invoices go" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/60 dark:text-muted-foreground">Email</dt>
                <dd className="font-mono text-[10px]">{ctx.org.billingEmail ?? "Not set"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/60 dark:text-muted-foreground">Currency</dt>
                <dd className="font-mono text-[10px]">{currency}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/60 dark:text-muted-foreground">Tax ID</dt>
                <dd className="font-mono text-[10px]">{ctx.org.taxId ?? "Not set"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-black/60 dark:text-muted-foreground">Billing address</dt>
                <dd className="max-w-[60%] text-right font-mono text-[10px]">
                  {billingAddressLines(address).length ? billingAddressLines(address).join(", ") : "Not set"}
                </dd>
              </div>
            </dl>
            {ctx.capabilities.manageBilling ? (
              <div className="flex items-center justify-between gap-3 border-t border-black/10 px-4 py-2.5 dark:border-border">
                <Link href="/app/settings" className="font-mono text-[9px] uppercase tracking-[0.12em] underline-offset-2 hover:underline">
                  Edit in settings
                </Link>
                {stripeReady && ctx.org.stripeCustomerId ? (
                  <form action={openBillingPortalAction}>
                    <button
                      type="submit"
                      className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 underline-offset-2 hover:text-black hover:underline dark:text-muted-foreground dark:hover:text-foreground"
                    >
                      Manage billing →
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Change plan"
            hint={trialOffered ? `${TRIAL_DAYS}-day trial on paid plans · no card to start` : "Upgrade or talk to sales"}
            bodyClassName="p-0"
          >
            <div className="divide-y divide-black/10 dark:divide-border">
              {upgradePlans.map((candidate) => {
                const checkoutReady = stripeReady && Boolean(priceIdFor(candidate.key, currency));
                if (candidate.key === "enterprise") {
                  return (
                    <Link key={candidate.key} href="/contact" className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium">{candidate.name}</p>
                        <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">Custom pricing</p>
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                        Contact →
                      </span>
                    </Link>
                  );
                }
                return (
                  <form
                    key={candidate.key}
                    action={checkoutReady ? startCheckoutAction : requestPlanChangeAction}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <input type="hidden" name="plan" value={candidate.key} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium">{candidate.name}</p>
                      <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">{formatPrice(candidate, currency)} / month</p>
                    </div>
                    <button
                      type="submit"
                      className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 underline-offset-2 hover:text-black hover:underline dark:text-muted-foreground dark:hover:text-foreground"
                    >
                      {checkoutReady ? (canTrial ? "Start trial →" : "Upgrade →") : "Request →"}
                    </button>
                  </form>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
