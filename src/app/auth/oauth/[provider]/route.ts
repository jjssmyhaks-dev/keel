import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { OAuthCookie, providerConfig } from "@/lib/oauth";

export async function GET(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const config = providerConfig(provider);
  const origin = process.env.APP_URL || "http://localhost:3000";
  if (!config) {
    return NextResponse.redirect(`${origin}/sign-in?notice=oauth-not-configured`);
  }

  const state = randomToken(24);
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(OAuthCookie.state(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${origin.replace(/\/$/, "")}/auth/oauth/${provider}/callback`,
    response_type: "code",
    scope: config.scope,
    state,
  });
  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "select_account");
  }
  return NextResponse.redirect(`${config.authorizeUrl}?${params.toString()}`);
}
