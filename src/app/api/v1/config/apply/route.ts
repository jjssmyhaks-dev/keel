import { parse as parseYaml } from "yaml";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  clientIp,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { applyConfig } from "@/lib/config/apply";

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{
      config?: unknown;
      yaml?: string;
      dryRun?: boolean;
      prune?: boolean;
    }>(req);

    let raw = body.config;
    if (raw === undefined && typeof body.yaml === "string") {
      try {
        raw = parseYaml(body.yaml);
      } catch {
        throw new ApiError(422, "invalid_yaml", "The YAML document could not be parsed.");
      }
    }
    if (raw === undefined) {
      throw new ApiError(422, "config_required", "Provide config (a JSON object) or yaml (a YAML document).");
    }

    const result = await applyConfig(
      {
        environmentId: auth.environment.id,
        organizationId: auth.organization.id,
        actorId: auth.apiKeyId,
        actorName: "API key",
        ip: clientIp(req),
        projectId: auth.project.id,
        plan: auth.organization.plan,
        planStatus: auth.organization.planStatus,
        isProduction: auth.environment.type === "production",
        confirmPrune: req.headers.get("x-authab-confirm") === "prune",
      },
      raw,
      { dryRun: body.dryRun === true, prune: body.prune === true },
    );

    return apiOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
