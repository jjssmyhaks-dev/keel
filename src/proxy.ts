import { NextResponse, type NextRequest } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Expose-Headers": "x-request-id, idempotency-replayed, retry-after",
  "Access-Control-Max-Age": "86400",
};

const CSRF_COOKIE = "authab_csrf";
const HOSTED_PATH = /^\/(consent|me)(\/|$)/;

/**
 * Hosted consent and control-center pages are never cached and always carry a
 * CSRF double-submit cookie. The token is injected into the request headers so
 * the very first server render can embed it in forms.
 */
function hostedPage(request: NextRequest) {
  const existing = request.cookies.get(CSRF_COOKIE)?.value;
  const headers = new Headers(request.headers);
  let token = existing;
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, "");
    const cookieHeader = headers.get("cookie");
    headers.set("cookie", `${cookieHeader ? `${cookieHeader}; ` : ""}${CSRF_COOKIE}=${token}`);
  }
  const response = NextResponse.next({ request: { headers } });
  if (!existing && token) {
    response.cookies.set(CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function proxy(request: NextRequest) {
  if (HOSTED_PATH.test(request.nextUrl.pathname)) return hostedPage(request);

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/api/v1/:path*", "/consent/:path*", "/me", "/me/:path*"],
};
