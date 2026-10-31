import { formatDistanceToNowStrict, format } from "date-fns";

export function relativeTime(date: Date | string | null | undefined) {
  if (!date) return "never";
  const value = typeof date === "string" ? new Date(date) : date;
  return `${formatDistanceToNowStrict(value, { addSuffix: false })} ago`;
}

export function absTime(date: Date | string | null | undefined) {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  return format(value, "d MMM yyyy, HH:mm:ss");
}

export function shortDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  return format(value, "d MMM yyyy");
}

export function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function money(minorUnits: number, currency = "USD") {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

export function maskHint(secret: string) {
  const clean = String(secret ?? "");
  if (clean.length <= 4) return "••••";
  return `••••${clean.slice(-4)}`;
}

export function riskLabel(risk: string) {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

export function statusTone(status: string) {
  switch (status) {
    case "active":
    case "healthy":
    case "allowed":
    case "approved":
    case "paid":
    case "operational":
      return "green";
    case "paused":
    case "warning":
    case "pending":
    case "beta":
      return "amber";
    case "suspended":
    case "error":
    case "broken":
    case "expired":
      return "orange";
    case "denied":
    case "revoked":
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function hourKey(date: Date) {
  return format(date, "HH:00");
}
