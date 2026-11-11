import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { beginLogin } from "@/lib/login";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const origin = process.env.APP_URL || "http://localhost:3000";
  const record = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (
    !record ||
    record.type !== "magic_link" ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    !record.userId
  ) {
    return NextResponse.redirect(`${origin}/sign-in?notice=magic-expired`);
  }

  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user || user.deletedAt) {
    return NextResponse.redirect(`${origin}/sign-in?notice=magic-expired`);
  }

  const claimed = await db.loginToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!claimed.count) {
    return NextResponse.redirect(`${origin}/sign-in?notice=magic-expired`);
  }
  const h = await headers();
  const outcome = await beginLogin(
    user,
    {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: h.get("user-agent") || undefined,
    },
    { authMethod: "magic" },
  );

  if (outcome.kind === "challenge") {
    return NextResponse.redirect(`${origin}/mfa?token=${encodeURIComponent(outcome.token)}`);
  }
  if (outcome.kind === "enroll") {
    return NextResponse.redirect(`${origin}/mfa/enroll?required=1`);
  }

  return NextResponse.redirect(`${origin}${user.onboardedAt ? "/app" : "/onboarding"}`);
}
