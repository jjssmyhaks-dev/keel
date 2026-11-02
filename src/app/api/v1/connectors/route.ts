import { apiOk, authenticateApiKey, handleApiError } from "@/lib/api";
import { CONNECTORS } from "@/lib/connectors";

export async function GET(req: Request) {
  try {
    await authenticateApiKey(req);
    return apiOk({
      object: "list",
      data: CONNECTORS.map((connector) => ({
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
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
