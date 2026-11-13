import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { END_USER_COOKIE, endUserSessionWithUser } from "@/lib/consent";
import { createEndUserDataRequest, endUserExport } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = await cookies();
  const session = await endUserSessionWithUser(store.get(END_USER_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL("/me", req.url));

  const rate = await consumeRateLimit(`me:export:${session.endUser.id}`, 5, 60 * 60_000);
  if (!rate.allowed) return NextResponse.redirect(new URL("/me?error=rate_limited", req.url));

  await createEndUserDataRequest({
    endUser: session.endUser,
    kind: "export",
    ip: clientIp(req),
  }).catch(() => null);
  const payload = await endUserExport(session.endUser);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="authab-end-user-${session.endUser.externalUserId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
