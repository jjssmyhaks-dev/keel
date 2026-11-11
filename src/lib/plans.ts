export type PlanKey = "free" | "pro" | "scale" | "enterprise";

export type PlanConfig = {
  key: PlanKey;
  name: string;
  description: string;
  priceUsd: number | null;
  priceInr: number | null;
  limits: {
    agents: number;
    callsPerMonth: number;
    credentials: number;
    retentionDays: number;
    members: number;
  };
  features: string[];
  production: boolean;
  highlight?: boolean;
  cta: string;
};

export const PLANS: PlanConfig[] = [
  {
    key: "free",
    name: "Free",
    description: "For prototypes and local agent development.",
    priceUsd: 0,
    priceInr: 0,
    limits: { agents: 5, callsPerMonth: 1000, credentials: 3, retentionDays: 7, members: 2 },
    features: [
      "Development environment only",
      "5 active agents",
      "1,000 proxy calls / month",
      "3 connections",
      "7-day audit retention",
      "Community support",
    ],
    production: false,
    cta: "Start free",
  },
  {
    key: "pro",
    name: "Pro",
    description: "For teams putting agents in front of real users.",
    priceUsd: 49,
    priceInr: 3999,
    limits: { agents: 25, callsPerMonth: 50000, credentials: 25, retentionDays: 90, members: 10 },
    features: [
      "Production mode unlocked",
      "25 active agents",
      "50,000 proxy calls / month",
      "25 connections",
      "90-day audit retention",
      "Approvals, Slack and webhook alerts",
      "Email support",
    ],
    production: true,
    highlight: true,
    cta: "Upgrade to Pro",
  },
  {
    key: "scale",
    name: "Scale",
    description: "For agent-first organizations with heavier traffic.",
    priceUsd: 199,
    priceInr: 15999,
    limits: { agents: 200, callsPerMonth: 500000, credentials: 200, retentionDays: 365, members: 50 },
    features: [
      "Everything in Pro",
      "200 active agents",
      "500,000 proxy calls / month",
      "200 connections",
      "1-year audit retention",
      "Custom OpenAPI connectors",
      "Advanced policies and delegation",
      "Priority support",
    ],
    production: true,
    cta: "Upgrade to Scale",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "For organizations that need custom volume, retention and commercial terms.",
    priceUsd: null,
    priceInr: null,
    limits: { agents: -1, callsPerMonth: -1, credentials: -1, retentionDays: 3650, members: -1 },
    features: [
      "Everything in Scale",
      "Custom volume and retention",
      "Unlimited custom connectors and versions",
      "Annual invoicing and procurement",
      "Security review and signed DPA",
      "Priority support and onboarding",
      "Named support contact",
    ],
    production: true,
    cta: "Contact sales",
  },
];

export function planFor(key: string): PlanConfig {
  return PLANS.find((p) => p.key === key) ?? PLANS[0];
}

export function formatPrice(plan: PlanConfig, currency: "USD" | "INR") {
  const value = currency === "INR" ? plan.priceInr : plan.priceUsd;
  if (value === null) return "Custom";
  if (value === 0) return currency === "INR" ? "₹0" : "$0";
  return currency === "INR" ? `₹${value.toLocaleString("en-IN")}` : `$${value}`;
}
