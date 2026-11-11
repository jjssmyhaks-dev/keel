import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/email";
import { setActiveOrg } from "@/lib/session";
import { auditHuman } from "@/lib/human-audit";
import {
  SSO_STATE_COOKIE,
  completeSsoLogin,
  consumeSsoState,
  exchangeOidcCode,
  unpackSsoConfig,
  type SsoLoginResult,
} from "@/lib/sso";

export const dynamic = "force-dynamic";

function failureNotice(reason: Extract<SsoLoginResult, { ok: false }>["reason"]) {
  switch (reason) {
    case "domain":
      return "sso-domain";
    case "deleted":
      return "account-deleted";
    case "suspended":
      return "sso-suspended";
    case "limit":
      return "sso-limit";
    default:
      return "sso-failed";
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const store = await cookies();
  const expectedState = store.get(SSO_STATE_COOKIE)?.value;
  store.delete(SSO_STATE_COOKIE);

  const connection = await db.ssoConnection.findUnique({
    where: { id },
    include: { org: { select: { deletedAt: true } } },
  });
  if (!connection || !connection.enabled || connection.org.deletedAt) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-disabled"));
  }
  if (error) return NextResponse.redirect(appUrl("/sign-in?notice=sso-cancelled"));
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-state"));
  }

  const stateMeta = await consumeSsoState(state, connection.id);
  if (!stateMeta || !stateMeta.verifier) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-state"));
  }

  try {
    const config = unpackSsoConfig(connection);
    if (config.kind !== "oidc") {
      return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"));
    }
    const profile = await exchangeOidcCode(connection, config, {
      code,
      verifier: stateMeta.verifier,
      nonce: stateMeta.nonce ?? "",
    });
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const result = await completeSsoLogin({
      connection,
      profile,
      meta: { ip, userAgent: h.get("user-agent") || undefined, device: "Web browser (SSO)" },
      next: stateMeta.next,
      assumeMfa: Boolean(config.assumeMfa),
    });
    if (!result.ok) {
      return NextResponse.redirect(appUrl(`/sign-in?notice=${failureNotice(result.reason)}`));
    }

    await setActiveOrg(result.orgId).catch(() => null);
    await auditHuman({
      userId: result.userId,
      actorName: profile.name,
      action: "auth.sso_login",
      outcome: "allowed",
      ip,
      payload: {
        connectionId: connection.id,
        connectionName: connection.name,
        protocol: "oidc",
        newUser: result.created,
        role: result.role,
      },
    });

    if (result.outcome.kind === "challenge") {
      return NextResponse.redirect(appUrl(`/mfa?token=${encodeURIComponent(result.outcome.token)}`));
    }
    if (result.outcome.kind === "enroll") {
      return NextResponse.redirect(appUrl("/mfa/enroll?required=1"));
    }
    return NextResponse.redirect(appUrl(stateMeta.next || "/app"));
  } catch (err) {
    console.error("[authab:sso:oidc]", err);
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"));
  }
}
