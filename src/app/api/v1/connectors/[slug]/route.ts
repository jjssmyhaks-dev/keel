import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, requireSecretKey } from "@/lib/api";
import { archiveCustomConnector, serializeCustomConnector } from "@/lib/custom-connectors";

async function loadCustomConnector(environmentId: string, slug: string) {
  const row = await db.customConnector.findUnique({
    where: { environmentId_slug: { environmentId, slug } },
    include: { versions: { orderBy: { version: "desc" }, select: { version: true, specVersion: true, createdAt: true } } },
  });
  if (!row) throw new ApiError(404, "connector_not_found", `No custom connector "${slug}" exists in this environment.`);
  return row;
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    const { slug } = await ctx.params;
    const row = await loadCustomConnector(auth.environment.id, slug);
    return apiOk({
      ...serializeCustomConnector(row),
      versions: row.versions.map((version) => ({
        version: version.version,
        specVersion: version.specVersion,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { slug } = await ctx.params;
    const archived = await archiveCustomConnector({
      environmentId: auth.environment.id,
      slug,
      createdBy: auth.apiKeyId,
    });
    if (!archived) throw new ApiError(404, "connector_not_found", `No custom connector "${slug}" exists in this environment.`);
    return apiOk({ object: "custom_connector", slug, archived: true, id: archived.id });
  } catch (error) {
    return handleApiError(error);
  }
}
