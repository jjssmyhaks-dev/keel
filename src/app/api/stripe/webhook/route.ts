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
  const subscriptionId = idOf(object.subscription);
  if (subscriptionId) {
    const org = await db.organization.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
    if (org) return org.id;
  }
  return null;
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
        await setOrganizationPlan({
          orgId,
          plan,
          status: "active",
          customerId: idOf(object.customer),
          subscriptionId: idOf(object.subscription),
        });
        await notify({
          orgId,
          type: "billing",
          title: `Plan activated: ${plan}`,
          body: "Stripe confirmed the subscription. The new limits apply immediately.",
          href: "/app/billing",
        });
      }
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const orgId = await orgIdFor(object);
      const status = String(object.status ?? "");
      if (orgId) {
        if (type === "customer.subscription.deleted" || status === "canceled" || status === "incomplete_expired") {
          await setOrganizationPlan({ orgId, plan: "free", status: "canceled", subscriptionId: null });
          await notify({
            orgId,
            type: "billing",
            title: "Subscription ended",
            body: "The workspace moved to the Free plan. Production writes and paid-plan limits no longer apply.",
            href: "/app/billing",
          });
        } else {
          const plan = (object.metadata?.plan as string | undefined) ?? undefined;
          if (plan) {
            await setOrganizationPlan({ orgId, plan, status: status || "active" });
          } else {
            await db.organization.update({ where: { id: orgId }, data: { planStatus: status || "active" } });
          }
          if (status === "past_due" || status === "unpaid") {
            await notify({
              orgId,
              type: "billing",
              title: "Payment failed",
              body: `Stripe reports the subscription is ${status}. Update the payment method in billing.`,
              href: "/app/billing",
            });
          }
        }
      }
    } else if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const orgId = await orgIdFor(object);
      if (orgId) {
        const paid = type === "invoice.paid";
        await recordStripeInvoice({
          orgId,
          number: String(object.number ?? object.id ?? "invoice"),
          amount: Number(object.amount_paid ?? object.amount_due ?? object.total ?? 0),
          currency: String(object.currency ?? "usd"),
          status: paid ? "paid" : "open",
          providerId: String(object.id ?? object.number ?? ""),
        });
        if (!paid) {
          await db.organization.update({ where: { id: orgId }, data: { planStatus: "past_due" } }).catch(() => null);
          await notify({
            orgId,
            type: "billing",
            title: "Invoice payment failed",
            body: "Stripe could not charge the saved payment method. Update billing to keep paid features.",
            href: "/app/billing",
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[authab:stripe] webhook processing failed", error);
    return NextResponse.json({ error: "webhook_processing_failed" }, { status: 500 });
  }
}
