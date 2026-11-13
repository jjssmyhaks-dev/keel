import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { END_USER_COOKIE, END_USER_SESSION_TTL_MS } from "@/lib/consent";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const invalid = NextResponse.redirect(new URL("/me?error=link", req.url));

  const link = await db.endUserLink.findUnique({ where: { tokenHash: sha256(token) } });
  if (!link || link.usedAt || link.expiresAt < new Date()) return invalid;
  const endUser = await db.endUser.findUnique({ where: { id: link.endUserId } });
  if (!endUser || endUser.deletedAt) return invalid;

  const sessionToken = randomToken(32);
  const session = await db.$transaction(async (tx) => {
    const consumed = await tx.endUserLink.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) return null;
    const created = await tx.endUserSession.create({
      data: {
        endUserId: endUser.id,
        tokenHash: sha256(sessionToken),
        expiresAt: new Date(Date.now() + END_USER_SESSION_TTL_MS),
      },
    });
    await tx.endUser.update({ where: { id: endUser.id }, data: { lastSeenAt: new Date() } }).catch(() => null);
    return created;
  });
  if (!session) return invalid;

  const store = await cookies();
  store.set(END_USER_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(END_USER_SESSION_TTL_MS / 1000),
  });
  return NextResponse.redirect(new URL("/me", req.url));
}
