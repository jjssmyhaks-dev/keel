import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/session";
import { provisionOrganization } from "@/lib/provisioning";
import { exchangeCode, OAuthCookie } from "@/lib/oauth";
import { auditEvent } from "@/lib/audit";
import { demoLoginEnabled } from "@/lib/demo";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const origin = process.env.APP_URL || "http://localhost:3000";
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const store = await cookies();
  const expectedState = store.get(OAuthCookie.state(provider))?.value;
  store.delete(OAuthCookie.state(provider));

  if (error || !code) {
    return NextResponse.redirect(`${origin}/sign-in?notice=oauth-cancelled`);
  }
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(`${origin}/sign-in?notice=oauth-state`);
  }

  try {
    const profile = await exchangeCode(provider as "google" | "github", code);
    if (profile.email === "demo@authab.dev" && !demoLoginEnabled()) {
      return NextResponse.redirect(`${origin}/sign-in?notice=demo-disabled`);
    }
    let user = await db.user.findUnique({ where: { email: profile.email } });

    if (!user) {
      user = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: new Date(),
        },
      });
      await provisionOrganization({
        userId: user.id,
        userName: user.name,
        orgName: `${profile.name.split(" ")[0]}'s workspace`,
        plan: "free",
      });
    }

    if (user.deletedAt) {
      return NextResponse.redirect(`${origin}/sign-in?notice=account-deleted`);
    }

    const h = await headers();
    await createSession(user.id, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: h.get("user-agent") || undefined,
      device: "Web browser (OAuth)",
    });

    const env = await db.environment.findFirst({
      where: { project: { org: { memberships: { some: { userId: user.id } } } } },
      orderBy: { createdAt: "asc" },
    });
    if (env) {
      await auditEvent({
        environmentId: env.id,
        actorType: "human",
        actorId: user.id,
        actorName: user.name,
        action: "auth.signed_in",
        resourceType: "user",
        resourceId: user.id,
        outcome: "recorded",
        payloadSummary: { method: provider },
      });
    }

    return NextResponse.redirect(`${origin}${user.onboardedAt ? "/app" : "/onboarding"}`);
  } catch (err) {
    console.error("[authab:oauth]", err);
    return NextResponse.redirect(`${origin}/sign-in?notice=oauth-failed`);
  }
}
