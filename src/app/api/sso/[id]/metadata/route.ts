import { db } from "@/lib/db";
import { samlMetadata, unpackSsoConfig } from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const connection = await db.ssoConnection.findUnique({ where: { id } });
  if (!connection || connection.type !== "saml" || !connection.enabled) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const config = unpackSsoConfig(connection);
    if (config.kind !== "saml") return new Response("Not found", { status: 404 });
    const xml = samlMetadata(connection, config);
    return new Response(xml, {
      headers: {
        "content-type": "application/samlmetadata+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
