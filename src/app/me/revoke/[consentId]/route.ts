import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/api";
import { revokeConsentRecord, END_USER_COOKIE, endUserSessionWithUser } from "@/lib/consent";
import { csrfMatches } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ consentId: string }> }) {
  const { consentId } = await ctx.params;
  const form = await req.formData();
  const back = (query: string) => NextResponse.redirect(new URL(`/me?${query}`, req.url), 303);
  if (!(await csrfMatches(form))) return back("error=csrf");

  const store = await cookies();
  const session = await endUserSessionWithUser(store.get(END_USER_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL("/me", req.url));

  const consent = await db.consent.findFirst({ where: { id: consentId, endUserId: session.endUser.id } });
  if (!consent) return back("error=consent");

  await revokeConsentRecord(
    consent.id,
    { actorType: "human", actorId: `enduser:${session.endUser.id}`, actorName: "End user" },
    { reason: "end_user_revoked", ip: clientIp(req) },
  );
  return back("revoked=1");
}
