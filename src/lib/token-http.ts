import { ApiError } from "./api";

export async function tokenParams(req: Request): Promise<Record<string, unknown>> {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_request", "Send a JSON object or application/x-www-form-urlencoded body.");
  }
}

export function stringParam(params: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = params[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function splitScopes(value: string) {
  return value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function scopeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => (typeof entry === "string" ? splitScopes(entry) : []));
  }
  if (typeof value === "string") return splitScopes(value);
  return [];
}

export function scopeMatches(pattern: string, action: string) {
  if (pattern === "*" || pattern === action) return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(action);
}

export function scopesAllowed(available: string[], requested: string[]) {
  return requested.every((action) => available.some((pattern) => scopeMatches(pattern, action)));
}

export function intersectScopes(left: string[], right: string[]) {
  const l = [...new Set(left)];
  const r = [...new Set(right)];
  if (l.includes("*") && r.includes("*")) return ["*"];
  if (l.includes("*")) return r;
  if (r.includes("*")) return l;
  const concrete = [...new Set([...l, ...r].filter((scope) => !scope.includes("*") && !scope.includes("?")))];
  if (concrete.length) {
    return concrete.filter(
      (action) => l.some((pattern) => scopeMatches(pattern, action)) && r.some((pattern) => scopeMatches(pattern, action)),
    );
  }
  return l.filter((pattern) => r.some((candidate) => scopeMatches(candidate, pattern)));
}

export function clampTtl(value: unknown, fallback = 300, max = 3600) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 60), max);
}

export function basicClientCredentials(req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}
