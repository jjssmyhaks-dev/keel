export const TRIAL_DAYS = 14;
export const DUNNING_GRACE_DAYS = 7;

export type TrialOrg = {
  stripeSubscriptionId: string | null;
  trialEndsAt: Date | null;
};

export function trialEligible(org: TrialOrg) {
  return !org.stripeSubscriptionId && !org.trialEndsAt;
}

export function daysUntil(date: Date | null, now = new Date()) {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86_400_000));
}

export function dunningEscalationDue(startedAt: Date | null, now = new Date()) {
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() >= DUNNING_GRACE_DAYS * 86_400_000;
}

export function invoiceDisplayStatus(status: string) {
  const key = status.toLowerCase();
  if (key === "paid") return { label: "Paid", badge: "approved" } as const;
  if (key === "open") return { label: "Open", badge: "pending" } as const;
  if (key === "draft") return { label: "Draft", badge: "recorded" } as const;
  if (key === "void") return { label: "Void", badge: "revoked" } as const;
  if (key === "uncollectible") return { label: "Uncollectible", badge: "failed" } as const;
  return { label: status, badge: "recorded" } as const;
}

export type BillingAddress = {
  line1: string;
  city: string;
  postalCode: string;
  country: string;
};

export const EMPTY_BILLING_ADDRESS: BillingAddress = {
  line1: "",
  city: "",
  postalCode: "",
  country: "",
};

export function parseBillingAddress(json: string | null | undefined): BillingAddress {
  let parsed: Record<string, unknown> = {};
  try {
    const value = json ? (JSON.parse(json) as unknown) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const pick = (key: string) => (typeof parsed[key] === "string" ? (parsed[key] as string).trim() : "");
  return {
    line1: pick("line1"),
    city: pick("city"),
    postalCode: pick("postalCode"),
    country: pick("country").toUpperCase().slice(0, 2),
  };
}

export function billingAddressLines(address: BillingAddress) {
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.line1, cityLine, address.country].filter(Boolean);
}

export type UsageStatementRow = { period: string; calls: number };

export type UsageStatement = {
  organization: string;
  plan: string;
  allowance: number;
  generatedAt: Date;
  rows: UsageStatementRow[];
};

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function usageStatementCsv(statement: UsageStatement) {
  const lines = [
    "# Authab usage statement",
    `# Organization: ${statement.organization.replace(/[\r\n]+/g, " ")}`,
    `# Plan: ${statement.plan}`,
    `# Generated: ${statement.generatedAt.toISOString()}`,
    "# This is a usage statement, not a tax invoice. Download invoices from the billing page.",
    "period,calls,included_calls,overage_calls,note",
  ];
  for (const row of statement.rows) {
    const overage = statement.allowance < 0 ? 0 : Math.max(0, row.calls - statement.allowance);
    lines.push(
      [
        csvCell(row.period),
        csvCell(row.calls),
        csvCell(statement.allowance < 0 ? "unlimited" : statement.allowance),
        csvCell(overage),
        csvCell(overage > 0 ? "Calls over the allowance were refused, not billed" : ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
