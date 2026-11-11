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

export type StripeBillingAddress = {
  line1?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function addressParams(address: StripeBillingAddress | null | undefined): Record<string, string> {
  if (!address) return {};
  const params: Record<string, string> = {};
  if (address.line1) params["address[line1]"] = address.line1;
  if (address.city) params["address[city]"] = address.city;
  if (address.postalCode) params["address[postal_code]"] = address.postalCode;
  if (address.country) params["address[country]"] = address.country.toUpperCase().slice(0, 2);
  return params;
}

export async function updateStripeCustomerBilling(opts: {
  customerId: string;
  orgName?: string;
  email?: string;
  address?: StripeBillingAddress | null;
}) {
  const params = {
    ...(opts.orgName ? { name: opts.orgName } : {}),
    ...(opts.email ? { email: opts.email } : {}),
    ...addressParams(opts.address),
  };
  if (!Object.keys(params).length) return;
  await stripeRequest(`/customers/${opts.customerId}`, params);
}

export async function ensureStripeCustomer(opts: {
  orgId: string;
  orgName: string;
  email: string;
  existingCustomerId?: string | null;
  address?: StripeBillingAddress | null;
}) {
  if (opts.existingCustomerId) {
    await updateStripeCustomerBilling({
      customerId: opts.existingCustomerId,
      orgName: opts.orgName,
      email: opts.email,
      address: opts.address,
    });
    return opts.existingCustomerId;
  }
  const customer = await stripeRequest<{ id: string }>("/customers", {
    name: opts.orgName,
    email: opts.email,
    "metadata[orgId]": opts.orgId,
    ...addressParams(opts.address),
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
  trialPeriodDays?: number;
}) {
  const params: Record<string, string> = {
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
    "automatic_tax[enabled]": "true",
    "tax_id_collection[enabled]": "true",
    "customer_update[address]": "auto",
    "customer_update[name]": "auto",
  };
  if (opts.trialPeriodDays && opts.trialPeriodDays > 0) {
    params["subscription_data[trial_period_days]"] = String(opts.trialPeriodDays);
    params.payment_method_collection = "if_required";
  }
  const session = await stripeRequest<{ id: string; url: string }>("/checkout/sessions", params);
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
  trialEndsAt?: Date | null;
  dunningStartedAt?: Date | null;
}) {
  await db.organization.update({
    where: { id: opts.orgId },
    data: {
      plan: opts.plan,
      planStatus: opts.status,
      ...(opts.customerId ? { stripeCustomerId: opts.customerId } : {}),
      ...(opts.subscriptionId !== undefined ? { stripeSubscriptionId: opts.subscriptionId } : {}),
      ...(opts.trialEndsAt !== undefined ? { trialEndsAt: opts.trialEndsAt } : {}),
      ...(opts.dunningStartedAt !== undefined ? { dunningStartedAt: opts.dunningStartedAt } : {}),
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
  hostedUrl?: string | null;
  pdfUrl?: string | null;
  paidAt?: Date | null;
  issuedAt?: Date | null;
}) {
  const fields = {
    number: opts.number,
    amount: opts.amount,
    currency: opts.currency.toUpperCase(),
    status: opts.status,
    hostedUrl: opts.hostedUrl ?? null,
    pdfUrl: opts.pdfUrl ?? null,
    paidAt: opts.paidAt ?? null,
  };
  const existing = await db.invoice.findFirst({
    where: { orgId: opts.orgId, providerId: opts.providerId },
  });
  if (existing) {
    return db.invoice.update({ where: { id: existing.id }, data: fields });
  }
  return db.invoice.create({
    data: {
      orgId: opts.orgId,
      providerId: opts.providerId,
      ...fields,
      ...(opts.issuedAt ? { issuedAt: opts.issuedAt } : {}),
    },
  });
}
