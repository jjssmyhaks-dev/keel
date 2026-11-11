import { ApiError, apiOk, apiError, authenticateApiKey, handleApiError, parseJson, requireSecretKey } from "@/lib/api";
import {
  ConnectorImportError,
  customConnectorAccess,
  rollbackCustomConnector,
  serializeCustomConnector,
} from "@/lib/custom-connectors";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const access = customConnectorAccess(auth.organization.plan, auth.organization.planStatus);
    if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    const { slug } = await ctx.params;
    const body = await parseJson<{ version?: number }>(req);
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiError(422, "invalid_version", "Provide the integer version to restore.");
    }
    const result = await rollbackCustomConnector({
      environmentId: auth.environment.id,
      slug,
      version,
      createdBy: auth.apiKeyId,
    });
    if (!result) throw new ApiError(404, "connector_not_found", `No custom connector "${slug}" exists in this environment.`);
    return apiOk({
      object: "custom_connector",
      unchanged: result.unchanged,
      version: result.version,
      connector: serializeCustomConnector(result.connector),
    });
  } catch (error) {
    if (error instanceof ConnectorImportError) {
      return apiError(422, error.code, error.message);
    }
    return handleApiError(error);
  }
}
