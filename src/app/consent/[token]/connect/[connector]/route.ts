import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { consentTokenHash, parseStringArray } from "@/lib/consent";
import { randomToken } from "@/lib/crypto";
import { clientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  CONNECT_COOKIE,
  buildAuthorizeUrl,
  connectCookieOptions,
  connectRedirectUri,
  createConnectState,
  resolveOAuthClient,
} from "@/lib/oauth-connect";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string; connector: string }> },
) {
  const { token, connector: connectorSlug } = await ctx.params;
  const back = (error: string) => {
    const url = new URL(`/consent/${encodeURIComponent(token)}`, req.url);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url);
  };

  const ip = clientIp(req);
  const rate = await consumeRateLimit(`consent:connect:${ip ?? "unknown"}`, 30);
  if (!rate.allowed) return back("rate_limited");

  const request = await db.consentRequest.findUnique({ where: { tokenHash: consentTokenHash(token) } });
  if (!request || request.status !== "pending" || request.expiresAt < new Date()) return back("request_closed");
  if (!parseStringArray(request.connectorSlugsJson).includes(connectorSlug)) return back("connector");
  const endUser = request.endUserId ? await db.endUser.findUnique({ where: { id: request.endUserId } }) : null;
  if (!endUser || endUser.deletedAt) return back("end_user");

  const client = await resolveOAuthClient(connectorSlug, request.environmentId);
  if (!client) return back("not_configured");

  const verifier = client.pkce ? randomToken(32) : undefined;
  const state = createConnectState({
    connectorSlug,
    environmentId: request.environmentId,
    userId: `enduser:${endUser.id}`,
    clientId: client.clientId,
    verifier,
    consentRequestId: request.id,
    consentReturnTo: `/consent/${encodeURIComponent(token)}`,
  });

  const store = await cookies();
  store.set(CONNECT_COOKIE, state.cookie, connectCookieOptions());
  return NextResponse.redirect(
    buildAuthorizeUrl(client, {
      redirectUri: connectRedirectUri(connectorSlug),
      state: state.state,
      verifier,
    }),
  );
}
