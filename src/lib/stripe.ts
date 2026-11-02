import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";

const API = "https://api.stripe.com/v1";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function priceIdFor(plan: string, currency: "USD" | "INR") {
  const key =
    plan === "pro"
      ? currency === "INR"
        ? "STRIPE_PRICE_PRO_INR"
        : "STRIPE_PRICE_PRO"
      : plan === "scale"
        ? currency === "INR"
          ? "STRIPE_PRICE_SCALE_INR"
          : "STRIPE_PRICE_SCALE"
        : "";
  return key ? process.env[key] ?? "" : "";
}

async function stripeRequest<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Stripe returned ${response.status}.`);
  }
  return body;
}

export async function ensureStripeCustomer(opts: {
  orgId: string;
  orgName: string;
  email: string;
  existingCustomerId?: string | null;
}) {
  if (opts.existingCustomerId) return opts.existingCustomerId;
  const customer = await stripeRequest<{ id: string }>("/customers", {
    name: opts.orgName,
    email: opts.email,
    "metadata[orgId]": opts.orgId,
  });
  await db.organization.update({
    where: { id: opts.orgId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createCheckoutSession(opts: {
  orgId: string;
  plan: string;
  priceId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const session = await stripeRequest<{ id: string; url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer: opts.customerId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: opts.orgId,
    "metadata[orgId]": opts.orgId,
    "metadata[plan]": opts.plan,
    "subscription_data[metadata][orgId]": opts.orgId,
    "subscription_data[metadata][plan]": opts.plan,
    allow_promotion_codes: "true",
  });
  return session;
}

export async function createPortalSession(opts: { customerId: string; returnUrl: string }) {
  const session = await stripeRequest<{ id: string; url: string }>("/billing_portal/sessions", {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
  return session;
}

export function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = header.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    (acc[key] ??= []).push(value);
    return acc;
  }, {});
  const timestamp = Number(parts.t?.[0] ?? 0);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const candidates = parts.v1 ?? [];
  return candidates.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function setOrganizationPlan(opts: {
  orgId: string;
  plan: string;
  status: string;
  customerId?: string | null;
  subscriptionId?: string | null;
}) {
  await db.organization.update({
    where: { id: opts.orgId },
    data: {
      plan: opts.plan,
      planStatus: opts.status,
      ...(opts.customerId ? { stripeCustomerId: opts.customerId } : {}),
      ...(opts.subscriptionId !== undefined ? { stripeSubscriptionId: opts.subscriptionId } : {}),
    },
  });
}

export async function recordStripeInvoice(opts: {
  orgId: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  providerId: string;
}) {
  const existing = await db.invoice.findFirst({ where: { orgId: opts.orgId, providerId: opts.providerId } });
  if (existing) {
    return db.invoice.update({
      where: { id: existing.id },
      data: { amount: opts.amount, status: opts.status },
    });
  }
  return db.invoice.create({
    data: {
      orgId: opts.orgId,
      number: opts.number,
      amount: opts.amount,
      currency: opts.currency.toUpperCase(),
      status: opts.status,
      providerId: opts.providerId,
    },
  });
}
