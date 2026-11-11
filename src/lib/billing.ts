import { db } from "./db";
import { notify } from "./notifications";
import { dunningEscalationDue } from "./billing-rules";

const DAY = 86_400_000;

/**
 * Safety net for missed Stripe webhooks: expire stale trials and escalate
 * dunning. Stripe remains the source of truth; this only moves organisations
 * forward when a webhook never arrived.
 */
export async function sweepBilling(now = new Date()) {
  let trialsExpired = 0;
  let dunningStarted = 0;
  let dunningEscalated = 0;

  const staleTrials = await db.organization.findMany({
    where: {
      deletedAt: null,
      planStatus: "trialing",
      trialEndsAt: { lt: new Date(now.getTime() - DAY) },
    },
    select: { id: true, name: true, trialEndsAt: true },
  });
  for (const org of staleTrials) {
    await db.organization.update({
      where: { id: org.id },
      data: { planStatus: "past_due", dunningStartedAt: now },
    });
    await notify({
      orgId: org.id,
      type: "billing",
      title: "Trial ended",
      body: "The trial period is over and no active subscription was confirmed. Paid limits are suspended until billing is restored.",
      href: "/app/billing",
    }).catch(() => null);
    trialsExpired += 1;
  }

  const untracked = await db.organization.findMany({
    where: { deletedAt: null, planStatus: "past_due", dunningStartedAt: null },
    select: { id: true },
  });
  for (const org of untracked) {
    await db.organization.update({ where: { id: org.id }, data: { dunningStartedAt: now } });
    dunningStarted += 1;
  }

  const overdue = await db.organization.findMany({
    where: {
      deletedAt: null,
      planStatus: "past_due",
      dunningStartedAt: { not: null, lte: new Date(now.getTime() - 7 * DAY) },
    },
    select: { id: true, dunningStartedAt: true },
  });
  for (const org of overdue) {
    if (!dunningEscalationDue(org.dunningStartedAt, now)) continue;
    await db.organization.update({
      where: { id: org.id },
      data: { planStatus: "unpaid" },
    });
    await notify({
      orgId: org.id,
      type: "billing",
      title: "Billing suspended",
      body: "Payment has been failing for a week. The workspace is on Free limits and production writes are disabled until an invoice is paid.",
      href: "/app/billing",
    }).catch(() => null);
    dunningEscalated += 1;
  }

  return { trialsExpired, dunningStarted, dunningEscalated };
}
