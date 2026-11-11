import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { connector } from "@/lib/connectors";
import { randomToken } from "@/lib/crypto";
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
  { params }: { params: Promise<{ connector: string }> },
) {
  const { connector: connectorSlug } = await params;
  const ctx = await getContext();
  const failure = (reason: string) =>
    NextResponse.redirect(new URL(`/app/vault?connect=${encodeURIComponent(connectorSlug)}&error=${reason}`, req.url));

  if (!ctx.capabilities.manageCredentials) return failure("permission");
  if (ctx.isProduction && !ctx.capabilities.writeProduction) return failure("production");

  const connectorDef = connector(connectorSlug);
  if (!connectorDef) return failure("connector");

  const environment = await db.environment.findUnique({ where: { id: ctx.environment.id } });
  if (!environment) return failure("environment");

  const client = await resolveOAuthClient(connectorSlug, environment.id);
  if (!client) return failure("not_configured");

  const verifier = client.pkce ? randomToken(32) : undefined;
  const state = createConnectState({
    connectorSlug,
    environmentId: environment.id,
    userId: ctx.user.id,
    clientId: client.clientId,
    verifier,
  });
  const redirectUri = connectRedirectUri(connectorSlug);
  const authorizeUrl = buildAuthorizeUrl(client, {
    redirectUri,
    state: state.state,
    verifier,
  });

  const store = await cookies();
  store.set(CONNECT_COOKIE, state.cookie, connectCookieOptions());
  return NextResponse.redirect(authorizeUrl);
}
