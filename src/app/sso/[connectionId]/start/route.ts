import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { appUrl } from "@/lib/email";
import {
  SSO_STATE_COOKIE,
  createSsoState,
  emailMatchesConnection,
  oidcAuthorizeUrl,
  pkceChallenge,
  safeNextPath,
  samlAuthorizeUrl,
  unpackSsoConfig,
} from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const next = safeNextPath(url.searchParams.get("next"));

  const connection = await db.ssoConnection.findUnique({
    where: { id: connectionId },
    include: { org: { select: { deletedAt: true } } },
  });
  if (!connection || !connection.enabled || connection.org.deletedAt) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-disabled"));
  }
  if (email && !emailMatchesConnection(connection, email)) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-domain"));
  }

  try {
    const config = unpackSsoConfig(connection);
    const nonce = randomToken(16);
    const verifier = randomToken(32);
    const challenge = pkceChallenge(verifier);
    const state = await createSsoState({ connectionId: connection.id, next, nonce, verifier });

    const authorizeUrl =
      config.kind === "oidc"
        ? await oidcAuthorizeUrl(connection, config, { state, nonce, codeChallenge: challenge })
        : await samlAuthorizeUrl(connection, config, state);

    const store = await cookies();
    store.set(SSO_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error("[authab:sso:start]", error);
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-config"));
  }
}
