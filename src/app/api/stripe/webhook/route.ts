import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  recordStripeInvoice,
  setOrganizationPlan,
  verifyStripeSignature,
} from "@/lib/stripe";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

type StripeObject = Record<string, unknown> & {
  id?: string;
  object?: string;
  status?: string;
  trial_end?: number | null;
  created?: number;
  amount_paid?: number;
  amount_due?: number;
  total?: number;
  currency?: string;
  number?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  attempt_count?: number;
  next_payment_attempt?: number | null;
  status_transitions?: { paid_at?: number | null };
  metadata?: Record<string, string>;
  customer?: string | { id?: string };
  subscription?: string | { id?: string };
};

function idOf(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

async function orgIdFor(object: StripeObject) {
  if (object.metadata?.orgId) return object.metadata.orgId;
  const customerId = idOf(object.customer);
  if (customerId) {
    const org = await db.organization.findUnique({ where: { stripeCustomerId: customerId } });
    if (org) return org.id;
  }
  const subscriptionId = idOf(object.subscription) ?? (object.object === "subscription" ? idOf(object.id) : null);
  if (subscriptionId) {
    const org = await db.organization.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
    if (org) return org.id;
  }
  return null;
}

function dateFromUnix(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

async function applySubscription(object: StripeObject) {
  const orgId = await orgIdFor(object);
  if (!orgId) return;
  const status = String(object.status ?? "active");
  const plan = object.metadata?.plan as string | undefined;
  const subscriptionId = idOf(object.id);

  if (status === "canceled" || status === "incomplete_expired") {
    await setOrganizationPlan({
      orgId,
      plan: "free",
      status: "canceled",
      subscriptionId: null,
      trialEndsAt: null,
      dunningStartedAt: null,
    });
    await notify({
      orgId,
      type: "billing",
      title: "Subscription ended",
      body: "The workspace moved to the Free plan. Production writes and paid-plan limits no longer apply.",
      href: "/app/billing",
    });
    return;
  }

  if (status === "trialing") {
    await setOrganizationPlan({
      orgId,
      plan: plan ?? "pro",
      status: "trialing",
      subscriptionId,
      trialEndsAt: dateFromUnix(object.trial_end),
      dunningStartedAt: null,
    });
    return;
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { plan: true, planStatus: true, dunningStartedAt: true },
  });
  if (!org) return;

  const failing = status === "past_due" || status === "unpaid";
  const enteringDunning = failing && org.planStatus !== "past_due" && org.planStatus !== "unpaid";

  if (plan || failing) {
    await setOrganizationPlan({
      orgId,
      plan: plan ?? org.plan,
      status,
      subscriptionId,
      trialEndsAt: null,
      ...(failing
        ? { dunningStartedAt: org.dunningStartedAt ?? new Date() }
        : { dunningStartedAt: null }),
    });
  } else {
    await db.organization.update({
      where: { id: orgId },
      data: { planStatus: status, dunningStartedAt: null, trialEndsAt: null },
    });
  }

  if (enteringDunning) {
    await notify({
      orgId,
      type: "billing",
      title: "Payment failed",
      body: `Stripe reports the subscription is ${status}. Update the payment method in billing.`,
      href: "/app/billing",
    });
  }
}

async function applyInvoice(object: StripeObject, paid: boolean) {
  const orgId = await orgIdFor(object);
  if (!orgId) return;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { planStatus: true, dunningStartedAt: true },
  });
  if (!org) return;

  await recordStripeInvoice({
    orgId,
    number: String(object.number ?? object.id ?? "invoice"),
    amount: Number(object.amount_paid ?? object.amount_due ?? object.total ?? 0),
    currency: String(object.currency ?? "usd"),
    status: paid ? "paid" : "open",
    providerId: String(object.id ?? object.number ?? ""),
    hostedUrl: typeof object.hosted_invoice_url === "string" ? object.hosted_invoice_url : null,
    pdfUrl: typeof object.invoice_pdf === "string" ? object.invoice_pdf : null,
    issuedAt: dateFromUnix(object.created),
    paidAt: paid ? (dateFromUnix(object.status_transitions?.paid_at) ?? new Date()) : null,
  });

  if (paid) {
    if (org.planStatus === "past_due" || org.planStatus === "unpaid") {
      await db.organization.update({
        where: { id: orgId },
        data: { planStatus: "active", dunningStartedAt: null },
      });
      await notify({
        orgId,
        type: "billing",
        title: "Payment received",
        body: "Stripe collected the outstanding invoice. The workspace is active again.",
        href: "/app/billing",
      });
    }
    return;
  }

  if (object.next_payment_attempt === null) {
    await db.organization.update({
      where: { id: orgId },
      data: { planStatus: "unpaid", dunningStartedAt: org.dunningStartedAt ?? new Date() },
    });
    await notify({
      orgId,
      type: "billing",
      title: "Dunning exhausted",
      body: "Stripe made its final collection attempt. The workspace stays suspended until an invoice is paid.",
      href: "/app/billing",
    });
    return;
  }

  await db.organization.update({
    where: { id: orgId },
    data: { planStatus: "past_due", dunningStartedAt: org.dunningStartedAt ?? new Date() },
  });
  await notify({
    orgId,
    type: "billing",
    title: "Invoice payment failed",
    body: `Attempt ${object.attempt_count ?? 1} failed. Stripe will retry; update billing to avoid suspension.`,
    href: "/app/billing",
  });
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "stripe_webhook_not_configured" }, { status: 503 });
  }
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: StripeObject } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const type = event.type ?? "";
  const object = event.data?.object ?? {};

  try {
    if (type === "checkout.session.completed") {
      const orgId = (object.metadata?.orgId as string | undefined) ?? (await orgIdFor(object));
      const plan = object.metadata?.plan as string | undefined;
      if (orgId && plan) {
        const org = await db.organization.findUnique({ where: { id: orgId }, select: { planStatus: true } });
        const trialing = org?.planStatus === "trialing";
        await setOrganizationPlan({
          orgId,
          plan,
          status: trialing ? "trialing" : "active",
          customerId: idOf(object.customer),
          subscriptionId: idOf(object.subscription),
          ...(trialing ? {} : { trialEndsAt: null }),
        });
        await notify({
          orgId,
          type: "billing",
          title: `Plan activated: ${plan}`,
          body: trialing
            ? "Stripe confirmed the trial. Trial limits apply until it converts to a paid subscription."
            : "Stripe confirmed the subscription. The new limits apply immediately.",
          href: "/app/billing",
        });
      }
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      await applySubscription(object);
    } else if (type === "customer.subscription.trial_will_end") {
      const orgId = await orgIdFor(object);
      if (orgId) {
        const ends = dateFromUnix(object.trial_end);
        await notify({
          orgId,
          type: "billing",
          title: "Trial ends soon",
          body: ends
            ? `The trial ends on ${ends.toISOString().slice(0, 10)}. Add a payment method to keep paid features.`
            : "The trial ends soon. Add a payment method to keep paid features.",
          href: "/app/billing",
        });
      }
    } else if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
      await applyInvoice(object, true);
    } else if (type === "invoice.payment_failed") {
      await applyInvoice(object, false);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[authab:stripe] webhook processing failed", error);
    return NextResponse.json({ error: "webhook_processing_failed" }, { status: 500 });
  }
}
