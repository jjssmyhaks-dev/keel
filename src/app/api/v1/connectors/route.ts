import {
  ApiError,
  apiOk,
  apiError,
  authenticateApiKey,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { CONNECTORS, type Connector } from "@/lib/connectors";
import {
  ConnectorImportError,
  customConnectorAccess,
  customConnectorToConnector,
  importOpenApiConnector,
  listCustomConnectors,
  serializeCustomConnector,
} from "@/lib/custom-connectors";

function handleImportError(error: unknown) {
  if (error instanceof ConnectorImportError) {
    return apiError(422, error.code, error.message);
  }
  return handleApiError(error);
}

function serializeCatalogConnector(connector: Connector) {
  return {
    object: "connector",
    slug: connector.slug,
    name: connector.name,
    category: connector.category,
    description: connector.description,
    mark: connector.mark,
    color: connector.color,
    docsUrl: connector.docsUrl,
    status: connector.status,
    version: connector.version,
    source: connector.source ?? "builtin",
    authMethods: connector.authMethods,
    defaultAuth: connector.defaultAuth,
    credentialFields: connector.credentialFields ?? [
      { key: "secret", label: "Secret", secret: true, required: true },
    ],
    requireAnyFields: connector.requireAnyFields ?? [],
    hosts: connector.hosts,
    injection: connector.injection,
    scopes: connector.scopes,
    resourceLabel: connector.resourceLabel,
    resourcePlaceholder: connector.resourcePlaceholder,
    redactedFields: connector.redactedFields,
    actions: connector.actions.map((action) => ({
      name: action.name,
      label: action.label,
      description: action.description,
      method: action.method,
      risk: action.risk,
      resourceLabel: action.resourceLabel ?? null,
      fields: action.fields ?? [],
    })),
  };
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const rows = await listCustomConnectors(auth.environment.id);
    const usable = rows.filter((row) => row.status === "active" && !row.archivedAt);
    return apiOk({
      object: "list",
      data: [
        ...CONNECTORS.map(serializeCatalogConnector),
        ...usable.map((row) => serializeCatalogConnector(customConnectorToConnector(row))),
      ],
      builtin: CONNECTORS.map((connector) => ({
        slug: connector.slug,
        name: connector.name,
        category: connector.category,
        version: connector.version,
        actions: connector.actions.length,
        auth: connector.defaultAuth,
      })),
      custom: rows.map(serializeCustomConnector),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const access = customConnectorAccess(auth.organization.plan, auth.organization.planStatus);
    if (!access.allowed) throw new ApiError(402, "plan_required", access.message);

    const body = await parseJson<{
      spec?: string;
      slug?: string;
      name?: string;
      category?: string;
      color?: string;
      mark?: string;
      baseUrl?: string;
      authScheme?: string;
    }>(req);

    if (!body.spec || !String(body.spec).trim()) {
      throw new ApiError(422, "spec_required", "Paste an OpenAPI 3 document as JSON or YAML.");
    }

    const result = await importOpenApiConnector({
      environmentId: auth.environment.id,
      specText: String(body.spec),
      slug: body.slug,
      name: body.name,
      category: body.category,
      color: body.color,
      mark: body.mark,
      baseUrl: body.baseUrl,
      authScheme: body.authScheme,
      createdBy: auth.apiKeyId,
    });

    return apiOk(
      {
        object: result.unchanged ? "custom_connector_unchanged" : "custom_connector",
        unchanged: result.unchanged,
        version: result.version,
        warnings: result.warnings,
        connector: serializeCustomConnector(result.connector),
      },
      { status: result.unchanged ? 200 : 201 },
    );
  } catch (error) {
    return handleImportError(error);
  }
}
