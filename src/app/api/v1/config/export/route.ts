import { stringify as toYaml } from "yaml";
import { ApiError, apiOk, authenticateApiKey, handleApiError, requestId } from "@/lib/api";
import { exportConfig } from "@/lib/config/export";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const format = (new URL(req.url).searchParams.get("format") ?? "json").toLowerCase();
    if (format !== "json" && format !== "yaml") {
      throw new ApiError(422, "invalid_format", "format must be json or yaml.");
    }

    const config = await exportConfig(auth.environment.id, auth.environment.type);
    if (format === "yaml") {
      return new Response(toYaml(config, { lineWidth: 0 }), {
        status: 200,
        headers: {
          "content-type": "application/yaml; charset=utf-8",
          "cache-control": "no-store",
          "x-request-id": requestId(),
        },
      });
    }
    return apiOk(config);
  } catch (error) {
    return handleApiError(error);
  }
}
