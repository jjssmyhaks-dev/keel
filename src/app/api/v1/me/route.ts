import { db } from "@/lib/db";
import { apiOk, authenticateApiKey, handleApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const key = await db.apiKey.findUnique({
      where: { id: auth.apiKeyId },
      select: { id: true, name: true, prefix: true, type: true, createdAt: true, lastUsedAt: true },
    });

    return apiOk({
      object: "api_key_context",
      key: key
        ? {
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            type: key.type,
            createdAt: key.createdAt.toISOString(),
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          }
        : null,
      organization: {
        id: auth.organization.id,
        name: auth.organization.name,
        slug: auth.organization.slug,
        plan: auth.organization.plan,
      },
      project: { id: auth.project.id, name: auth.project.name },
      environment: { id: auth.environment.id, type: auth.environment.type },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
