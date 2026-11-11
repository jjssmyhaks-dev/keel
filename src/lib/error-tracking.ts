import { db } from "./db";
import { newId, sha256 } from "./crypto";
import { ENV_COOKIE, ORG_COOKIE, SESSION_COOKIE } from "./cookies";
import { recordErrorSpan, traceIdFromTraceparent } from "./tracing";

type HeaderBag = Record<string, string | string[] | undefined>;

export type RequestErrorContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
};

function header(headers: HeaderBag, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(raw?: string) {
  const out: Record<string, string> = {};
  for (const part of raw?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

async function attribution(cookies: Record<string, string>) {
  const token = cookies[SESSION_COOKIE];
  if (!token) return {};
  try {
    const session = await db.session.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { memberships: { select: { orgId: true }, take: 10 } } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return {};
    const memberships = session.user.memberships;
    const orgId = memberships.find((row) => row.orgId === cookies[ORG_COOKIE])?.orgId ?? memberships[0]?.orgId;
    const environmentId = orgId
      ? (
          await db.environment.findFirst({
            where: { id: cookies[ENV_COOKIE] ?? "", project: { orgId } },
            select: { id: true },
          })
        )?.id
      : undefined;
    return { userId: session.userId, orgId, environmentId };
  } catch {
    return {};
  }
}

/**
 * Persists an unhandled server error from Next's instrumentation hook. It is
 * best-effort: error reporting must never turn into a second failure.
 */
export async function recordRequestError(
  error: unknown,
  request: { path: string; method: string; headers: HeaderBag },
  context: RequestErrorContext,
): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const err = error instanceof Error ? error : new Error(String(error));
    const headers = request.headers ?? {};
    const route = (context.routePath || request.path || "unknown").slice(0, 300);
    const traceparent = header(request.headers, "traceparent");
    const traceId =
      recordErrorSpan(
        err,
        {
          "http.route": route,
          "http.request.method": request.method || "GET",
          "authab.error.message": err.message.slice(0, 300),
          "authab.router.kind": context.routerKind,
          "authab.route.type": context.routeType,
        },
        traceparent,
      ) ?? traceIdFromTraceparent(traceparent);
    const cookies = parseCookies(header(headers, "cookie"));
    const who = await attribution(cookies);
    const digest = (error as { digest?: unknown } | null)?.digest;
    const requestId =
      header(headers, "x-request-id") ?? header(headers, "x-authab-request-id") ?? newId("req_");

    await db.errorEvent.create({
      data: {
        orgId: who.orgId ?? null,
        environmentId: who.environmentId ?? null,
        userId: who.userId ?? null,
        requestId: requestId.slice(0, 120),
        traceId: traceId ?? null,
        route,
        method: request.method?.slice(0, 10) ?? null,
        message: (err.message || err.name || "Unknown server error").slice(0, 1000),
        digest: typeof digest === "string" ? digest.slice(0, 120) : null,
        stack: err.stack?.slice(0, 8000) ?? null,
        userAgent: header(headers, "user-agent")?.slice(0, 400) ?? null,
        ip:
          header(headers, "x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) ??
          header(headers, "x-real-ip")?.slice(0, 64) ??
          null,
      },
    });
  } catch (reportError) {
    console.error("[authab] failed to record request error", reportError);
  }
}
