import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { END_USER_COOKIE, endUserSessionWithUser } from "@/lib/consent";
import { createEndUserDataRequest, csrfMatches } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const form = await req.formData();
  const back = (query: string) => NextResponse.redirect(new URL(`/me?${query}`, req.url), 303);
  if (kind !== "delete") return back("error=request");
  if (!(await csrfMatches(form))) return back("error=csrf");

  const store = await cookies();
  const session = await endUserSessionWithUser(store.get(END_USER_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL("/me", req.url));

  const rate = await consumeRateLimit(`me:data:${session.endUser.id}`, 3, 24 * 60 * 60_000);
  if (!rate.allowed) return back("error=rate_limited");

  await createEndUserDataRequest({
    endUser: session.endUser,
    kind: "delete",
    ip: clientIp(req),
  });
  return back("requested=delete");
}
