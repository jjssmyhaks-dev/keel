import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, requireSecretKey } from "@/lib/api";
import { serializeConsent } from "@/lib/consent";

export async function GET(req: Request, ctx: { params: Promise<{ externalUserId: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { externalUserId } = await ctx.params;
    const endUser = await db.endUser.findFirst({
      where: { projectId: auth.project.id, externalUserId: decodeURIComponent(externalUserId) },
    });
    if (!endUser || endUser.deletedAt) {
      throw new ApiError(404, "end_user_not_found", "No end user with that external id exists in this project.");
    }

    const [consents, dataRequests, credentials, agents] = await Promise.all([
      db.consent.findMany({ where: { projectId: auth.project.id, endUserId: endUser.id }, orderBy: { grantedAt: "desc" } }),
      db.dataRequest.findMany({ where: { projectId: auth.project.id, endUserId: endUser.id }, orderBy: { createdAt: "desc" } }),
      db.credential.findMany({
        where: { environmentId: auth.environment.id, endUserId: endUser.id },
        select: {
          id: true,
          name: true,
          connectorSlug: true,
          type: true,
          status: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.agent.findMany({ where: { environmentId: auth.environment.id }, select: { id: true, name: true } }),
    ]);
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

    return apiOk({
      id: endUser.id,
      externalUserId: endUser.externalUserId,
      email: endUser.email,
      createdAt: endUser.createdAt.toISOString(),
      lastSeenAt: endUser.lastSeenAt?.toISOString() ?? null,
      consents: consents.map((consent) => serializeConsent(consent, agentNames.get(consent.agentId))),
      connections: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        connector: credential.connectorSlug,
        type: credential.type,
        status: credential.revokedAt ? "revoked" : credential.status,
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
        revokedAt: credential.revokedAt?.toISOString() ?? null,
      })),
      dataRequests: dataRequests.map((request) => ({
        id: request.id,
        kind: request.kind,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        completedAt: request.completedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
