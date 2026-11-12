import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { planFor } from "@/lib/plans";
import { THEME_COOKIE, themeFor } from "@/lib/theme";
import { ColorModePicker } from "@/components/app/color-mode-picker";
import { ThemePicker } from "@/components/app/theme-picker";
import {
  updateOrganizationAction,
  updateProjectAction,
  updateDataContributionAction,
  revokeSessionAction,
} from "@/app/app/actions";
import { PageHeader, Panel, Notice, StatusBadge, formatDate, relativeTime } from "@/components/app/ui";
import { parseBillingAddress } from "@/lib/billing-rules";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const plan = planFor(ctx.org.plan);
  const theme = themeFor((await cookies()).get(THEME_COOKIE)?.value);
  const billingAddress = parseBillingAddress(ctx.org.billingAddressJson);
  const canEditBilling = ctx.capabilities.manageBilling;

  const sessions = await db.session.findMany({
    where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeen: "desc" },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Settings · workspace"
        title="Names, keys and sessions."
        description="Organization-level identity, project naming and the devices currently holding a session. Environment guardrails live under Security."
        actions={
          <Link href="/app/security" className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card">
            Security settings
          </Link>
        }
      />

      {query.error ? (
        <Notice kind="error">
          {query.error === "permission" ? "Only owners and admins can change these settings." : "Those settings could not be saved."}
        </Notice>
      ) : null}
      {query.saved ? <Notice kind="ok">Settings saved.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Organization" hint={`${ctx.org.slug} · ${plan.name} plan`} bodyClassName="p-4">
            <form action={updateOrganizationAction} className="space-y-4">
              <div>
                <label htmlFor="name" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Organization name
                </label>
                <input
                  id="name"
                  name="name"
                  defaultValue={ctx.org.name}
                  required
                  maxLength={80}
                  className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="billingEmail" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Billing email
                  </label>
                  <input
                    id="billingEmail"
                    name="billingEmail"
                    type="email"
                    defaultValue={ctx.org.billingEmail ?? ""}
                    placeholder="finance@company.com"
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="currency" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Billing currency
                  </label>
                  <select
                    id="currency"
                    name="currency"
                    defaultValue={ctx.org.billingCurrency}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                  >
                    <option value="USD">USD — US dollar</option>
                    <option value="INR">INR — Indian rupee</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div>
                  <label htmlFor="taxId" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Tax ID
                  </label>
                  <input
                    id="taxId"
                    name="taxId"
                    defaultValue={ctx.org.taxId ?? ""}
                    maxLength={40}
                    placeholder="GSTIN, VAT ID or equivalent"
                    disabled={!canEditBilling}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="billingCountry" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Country
                  </label>
                  <input
                    id="billingCountry"
                    name="billingCountry"
                    defaultValue={billingAddress.country}
                    maxLength={2}
                    placeholder="US"
                    disabled={!canEditBilling}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[12px] uppercase outline-none focus:border-black disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label htmlFor="billingLine1" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Billing address
                  </label>
                  <input
                    id="billingLine1"
                    name="billingLine1"
                    defaultValue={billingAddress.line1}
                    maxLength={120}
                    placeholder="Street address"
                    disabled={!canEditBilling}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="billingCity" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    City
                  </label>
                  <input
                    id="billingCity"
                    name="billingCity"
                    defaultValue={billingAddress.city}
                    maxLength={80}
                    disabled={!canEditBilling}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="billingPostalCode" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Postal code
                  </label>
                  <input
                    id="billingPostalCode"
                    name="billingPostalCode"
                    defaultValue={billingAddress.postalCode}
                    maxLength={20}
                    disabled={!canEditBilling}
                    className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  />
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                {canEditBilling
                  ? "Tax ID and address appear on Stripe invoices. Stripe Tax calculates tax at checkout."
                  : "Billing fields need the manage billing capability; owners and admins can grant it under Team."}
              </p>
              <button
                disabled={!ctx.capabilities.manageBilling && ctx.role !== "admin"}
                className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Save organization
              </button>
            </form>
          </Panel>

          <Panel title="Project" hint="One project, two environments" bodyClassName="p-4">
            <form action={updateProjectAction} className="space-y-4">
              <div>
                <label htmlFor="projectName" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Project name
                </label>
                <input
                  id="projectName"
                  name="name"
                  defaultValue={ctx.project.name}
                  required
                  maxLength={80}
                  className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ctx.environments.map((environment) => (
                  <div key={environment.id} className="flex items-center justify-between border border-black/10 px-3 py-2 dark:border-border">
                    <div>
                      <p className="text-[12px] capitalize">{environment.type}</p>
                      <p className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {environment.id === ctx.environment.id ? "current environment" : "switchable"}
                      </p>
                    </div>
                    <StatusBadge status={environment.id === ctx.environment.id ? "active" : "recorded"} />
                  </div>
                ))}
              </div>
              <button
                disabled={!ctx.capabilities.manageSecurity}
                className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Save project
              </button>
            </form>
          </Panel>

          <Panel title="Appearance" hint="This browser" bodyClassName="p-4">
            <div className="space-y-5">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Color mode
                </p>
                <div className="mt-2">
                  <ColorModePicker />
                </div>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Workspace theme
                </p>
                <div className="mt-2">
                  <ThemePicker initial={theme.id} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Data and privacy" hint="Contribution" bodyClassName="p-4">
            <form action={updateDataContributionAction} className="space-y-3">
              <label className="flex items-start gap-2 text-[12px] leading-relaxed">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={ctx.org.dataContributionEnabled}
                  disabled={!ctx.capabilities.manageSecurity}
                  className="mt-0.5 size-3.5 accent-black"
                />
                Contribute anonymized usage statistics
              </label>
              <p className="text-[10px] leading-relaxed text-black/60 dark:text-muted-foreground">
                Uses only decision types, action names and counts, never request content, resource names or personal
                data. Used to improve default policies and agent reputation. You can turn this off at any time.
              </p>
              <button
                disabled={!ctx.capabilities.manageSecurity}
                className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Save preference
              </button>
            </form>
          </Panel>

          <Panel title="Sessions" hint="Devices holding a live cookie" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {sessions.map((session) => {
                const current = session.id === ctx.session.id;
                return (
                  <div key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px]">
                        {session.device ?? "Web browser"}
                        {current ? <span className="ml-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">(this device)</span> : null}
                      </p>
                      <p className="truncate font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {session.ip ?? "unknown IP"} · seen {relativeTime(session.lastSeen)} · created {formatDate(session.createdAt)}
                      </p>
                    </div>
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <button className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8c3225] dark:text-[#f0a396] underline-offset-2 hover:underline">
                        {current ? "Sign out" : "Revoke"}
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-black/10 px-4 py-2.5 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
              Sessions expire after 30 days of inactivity. Revoking is immediate and does not affect agent tokens.
            </p>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Account" hint="Your membership" bodyClassName="p-0">
            <dl className="divide-y divide-black/10 text-[12px] dark:divide-border">
              <Row label="Name" value={ctx.user.name} />
              <Row label="Email" value={ctx.user.email} />
              <Row label="Email status" value={ctx.user.emailVerifiedAt ? `Verified ${formatDate(ctx.user.emailVerifiedAt)}` : "Unverified"} />
              <Row label="Role here" value={ctx.role} />
              <Row label="Member since" value={formatDate(ctx.membership.createdAt)} />
              <Row label="Organizations" value={String(ctx.memberships.length)} />
            </dl>
            {!ctx.user.emailVerifiedAt ? (
              <p className="border-t border-black/10 px-4 py-2.5 text-[10px] leading-relaxed text-[#8c5a12] dark:text-[#e8b26a] dark:border-border">
                Verify your email before promoting agents to production.
              </p>
            ) : null}
          </Panel>

          <Panel title="Environments" hint="Same project, separate everything" bodyClassName="p-4">
            <div className="space-y-2.5">
              <div className="border border-black/10 p-3 dark:border-border">
                <p className="text-[12px] font-medium">Development</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Reads and writes run by default. Destructive and financial calls still ask. Unlimited safe iteration.
                </p>
              </div>
              <div className="border border-black/10 p-3 dark:border-border">
                <p className="text-[12px] font-medium">Production</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                  Everything above reads needs approval. Only owners and admins can change it, and agents arrive through
                  promotion with a fresh identity.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Plan" hint={plan.name} bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">{plan.description}</p>
            <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-3 dark:border-border">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">Retention</span>
              <span className="font-mono text-[10px]">{plan.limits.retentionDays} days</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">Members</span>
              <span className="font-mono text-[10px]">{plan.limits.members < 0 ? "Unlimited" : plan.limits.members}</span>
            </div>
            <Link href="/app/billing" className="mt-3 inline-block border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white hover:bg-[#eca8d6] hover:text-black">
              Billing and usage
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-2.5">
      <dt className="text-black/60 dark:text-muted-foreground">{label}</dt>
      <dd className="text-right capitalize">{value}</dd>
    </div>
  );
}
