import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { END_USER_COOKIE } from "@/lib/consent";
import { csrfMatches } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await csrfMatches(await req.formData()))) {
    return NextResponse.redirect(new URL("/me?error=csrf", req.url), 303);
  }
  const store = await cookies();
  const token = store.get(END_USER_COOKIE)?.value;
  if (token) {
    await db.endUserSession.deleteMany({ where: { tokenHash: sha256(token) } }).catch(() => null);
  }
  store.set(END_USER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.redirect(new URL("/me", req.url), 303);
}
