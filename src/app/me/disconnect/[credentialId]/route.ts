import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/api";
import { END_USER_COOKIE, endUserSessionWithUser } from "@/lib/consent";
import { csrfMatches, revokeEndUserCredential } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await ctx.params;
  const form = await req.formData();
  const back = (query: string) => NextResponse.redirect(new URL(`/me?${query}`, req.url), 303);
  if (!(await csrfMatches(form))) return back("error=csrf");

  const store = await cookies();
  const session = await endUserSessionWithUser(store.get(END_USER_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL("/me", req.url));

  const revoked = await revokeEndUserCredential({
    credentialId,
    endUserId: session.endUser.id,
    ip: clientIp(req),
  });
  return back(revoked ? "disconnected=1" : "error=credential");
}
