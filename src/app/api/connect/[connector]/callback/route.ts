import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { connector } from "@/lib/connectors";
import { parseStringArray } from "@/lib/consent";
import { revokeEndUserCredential } from "@/lib/control-center";
import {
  CONNECT_COOKIE,
  connectCookieOptions,
  connectRedirectUri,
  createOAuthCredential,
  exchangeAuthorizationCode,
  gatherConnectionProfile,
  resolveOAuthClient,
  stateMatches,
  verifyConnectState,
  type ConnectStatePayload,
} from "@/lib/oauth-connect";

export const dynamic = "force-dynamic";

function back(req: Request, connectorSlug: string, query: string) {
  return NextResponse.redirect(
    new URL(`/app/vault?connect=${encodeURIComponent(connectorSlug)}&${query}`, req.url),
  );
}

function backToConsent(req: Request, state: ConnectStatePayload, query: string) {
  const base = state.consentReturnTo ?? "/me";
  const separator = base.includes("?") ? "&" : "?";
  return NextResponse.redirect(new URL(`${base}${separator}${query}`, req.url));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ connector: string }> },
) {
  const { connector: connectorSlug } = await params;
  const url = new URL(req.url);
  const store = await cookies();
  const cookie = store.get(CONNECT_COOKIE)?.value;
  store.set(CONNECT_COOKIE, "", { ...connectCookieOptions(), maxAge: 0 });

  const state = verifyConnectState(cookie);
  if (!state || state.connectorSlug !== connectorSlug) {
    return back(req, connectorSlug, "error=state");
  }
  const consentFlow = Boolean(state.consentRequestId);
  const fail = (query: string) => (consentFlow ? backToConsent(req, state, query) : back(req, connectorSlug, query));
  if (!stateMatches(state.nonce, url.searchParams.get("state"))) {
    return fail("error=state");
  }

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return fail(`error=denied&detail=${encodeURIComponent(providerError.slice(0, 120))}`);
  }
  const code = url.searchParams.get("code");
  if (!code) return fail("error=missing_code");

  const connectorDef = connector(connectorSlug);
  if (!connectorDef) return fail("error=connector");

  if (consentFlow) {
    const request = await db.consentRequest.findUnique({ where: { id: state.consentRequestId! } });
    if (!request || request.status !== "pending" || request.expiresAt < new Date()) {
      return fail("error=request_closed");
    }
    if (!parseStringArray(request.connectorSlugsJson).includes(connectorSlug)) {
      return fail("error=connector");
    }
    const endUser = request.endUserId ? await db.endUser.findUnique({ where: { id: request.endUserId } }) : null;
    if (!endUser || endUser.deletedAt) return fail("error=end_user");

    const client = await resolveOAuthClient(connectorSlug, request.environmentId);
    if (!client) return fail("error=not_configured");
    if (client.clientId !== state.clientId) return fail("error=state");

    try {
      const tokens = await exchangeAuthorizationCode(client, {
        code,
        redirectUri: connectRedirectUri(connectorSlug),
        verifier: state.verifier,
      });
      const profile = await gatherConnectionProfile(client, tokens);
      const previous = await db.credential.findMany({
        where: { environmentId: request.environmentId, connectorSlug, endUserId: endUser.id, revokedAt: null },
        select: { id: true },
      });
      for (const row of previous) {
        await revokeEndUserCredential({ credentialId: row.id, endUserId: endUser.id }).catch(() => null);
      }
      await createOAuthCredential({
        environmentId: request.environmentId,
        connectorSlug,
        userId: `enduser:${endUser.id}`,
        client,
        tokens,
        profile,
        endUserId: endUser.id,
        endUserAccount: endUser.email ?? endUser.externalUserId,
      });
      return fail(`connected=${encodeURIComponent(connectorSlug)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "OAuth connection failed.";
      return fail(`error=exchange&detail=${encodeURIComponent(detail.slice(0, 240))}`);
    }
  }

  const session = await getSession();
  if (!session || session.user.id !== state.userId) {
    return NextResponse.redirect(
      new URL(`/sign-in?next=${encodeURIComponent(`/app/vault?connect=${connectorSlug}`)}`, req.url),
    );
  }

  const environment = await db.environment.findFirst({
    where: {
      id: state.environmentId,
      project: { org: { memberships: { some: { userId: session.user.id } } } },
    },
  });
  if (!environment) return back(req, connectorSlug, "error=environment");

  const client = await resolveOAuthClient(connectorSlug, environment.id);
  if (!client) return back(req, connectorSlug, "error=not_configured");
  if (client.clientId !== state.clientId) return back(req, connectorSlug, "error=state");

  try {
    const tokens = await exchangeAuthorizationCode(client, {
      code,
      redirectUri: connectRedirectUri(connectorSlug),
      verifier: state.verifier,
    });
    const profile = await gatherConnectionProfile(client, tokens);
    const credential = await createOAuthCredential({
      environmentId: environment.id,
      connectorSlug,
      userId: session.user.id,
      client,
      tokens,
      profile,
    });
    return NextResponse.redirect(new URL(`/app/vault/${credential.id}?connected=1`, req.url));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "OAuth connection failed.";
    return back(
      req,
      connectorSlug,
      `error=exchange&detail=${encodeURIComponent(detail.slice(0, 240))}`,
    );
  }
}
