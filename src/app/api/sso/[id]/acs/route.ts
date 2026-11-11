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
  unpackSsoConfig,
  validateSamlResponse,
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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const connection = await db.ssoConnection.findUnique({
    where: { id },
    include: { org: { select: { deletedAt: true } } },
  });
  if (!connection || !connection.enabled || connection.org.deletedAt) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-disabled"), 303);
  }

  let body: Record<string, string>;
  try {
    const form = await req.formData();
    body = {
      SAMLResponse: String(form.get("SAMLResponse") ?? ""),
      RelayState: String(form.get("RelayState") ?? ""),
    };
  } catch {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"), 303);
  }
  if (!body.SAMLResponse) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"), 303);
  }

  const store = await cookies();
  const expectedState = store.get(SSO_STATE_COOKIE)?.value;
  store.delete(SSO_STATE_COOKIE);
  if (!expectedState || !body.RelayState || expectedState !== body.RelayState) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-state"), 303);
  }

  const stateMeta = await consumeSsoState(body.RelayState, connection.id);
  if (!stateMeta) {
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-state"), 303);
  }

  try {
    const config = unpackSsoConfig(connection);
    if (config.kind !== "saml") {
      return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"), 303);
    }
    const { profile } = await validateSamlResponse(connection, config, body);
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const result = await completeSsoLogin({
      connection,
      profile,
      meta: { ip, userAgent: h.get("user-agent") || undefined, device: "Web browser (SAML SSO)" },
      next: stateMeta.next,
      assumeMfa: Boolean(config.assumeMfa),
    });
    if (!result.ok) {
      return NextResponse.redirect(appUrl(`/sign-in?notice=${failureNotice(result.reason)}`), 303);
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
        protocol: "saml",
        newUser: result.created,
        role: result.role,
      },
    });

    if (result.outcome.kind === "challenge") {
      return NextResponse.redirect(appUrl(`/mfa?token=${encodeURIComponent(result.outcome.token)}`), 303);
    }
    if (result.outcome.kind === "enroll") {
      return NextResponse.redirect(appUrl("/mfa/enroll?required=1"), 303);
    }
    return NextResponse.redirect(appUrl(stateMeta.next || "/app"), 303);
  } catch (err) {
    console.error("[authab:sso:saml]", err);
    return NextResponse.redirect(appUrl("/sign-in?notice=sso-failed"), 303);
  }
}
