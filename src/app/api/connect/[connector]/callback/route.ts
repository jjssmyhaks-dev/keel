import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { connector } from "@/lib/connectors";
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
} from "@/lib/oauth-connect";

export const dynamic = "force-dynamic";

function back(req: Request, connectorSlug: string, query: string) {
  return NextResponse.redirect(
    new URL(`/app/vault?connect=${encodeURIComponent(connectorSlug)}&${query}`, req.url),
  );
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
  if (!stateMatches(state.nonce, url.searchParams.get("state"))) {
    return back(req, connectorSlug, "error=state");
  }

  const session = await getSession();
  if (!session || session.user.id !== state.userId) {
    return NextResponse.redirect(
      new URL(`/sign-in?next=${encodeURIComponent(`/app/vault?connect=${connectorSlug}`)}`, req.url),
    );
  }

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return back(req, connectorSlug, `error=denied&detail=${encodeURIComponent(providerError.slice(0, 120))}`);
  }
  const code = url.searchParams.get("code");
  if (!code) return back(req, connectorSlug, "error=missing_code");

  const connectorDef = connector(connectorSlug);
  if (!connectorDef) return back(req, connectorSlug, "error=connector");

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
