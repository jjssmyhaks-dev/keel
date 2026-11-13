import { db } from "@/lib/db";
import { apiOk, authenticateApiKey, handleApiError, requireSecretKey } from "@/lib/api";
import { serializeConsent } from "@/lib/consent";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const rows = await db.endUser.findMany({
      where: { projectId: auth.project.id, deletedAt: null },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: {
        consents: { where: { projectId: auth.project.id }, orderBy: { grantedAt: "desc" } },
      },
    });
    const endUserIds = rows.map((row) => row.id);
    const [agents, dataRequests] = await Promise.all([
      db.agent.findMany({
        where: { environmentId: auth.environment.id },
        select: { id: true, name: true },
      }),
      endUserIds.length
        ? db.dataRequest.findMany({
            where: { projectId: auth.project.id, endUserId: { in: endUserIds } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    const requestsByUser = new Map<string, typeof dataRequests>();
    for (const request of dataRequests) {
      const list = requestsByUser.get(request.endUserId) ?? [];
      list.push(request);
      requestsByUser.set(request.endUserId, list);
    }

    return apiOk({
      object: "list",
      data: rows.map((row) => ({
        id: row.id,
        externalUserId: row.externalUserId,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        consents: row.consents.map((consent) => serializeConsent(consent, agentNames.get(consent.agentId))),
        dataRequests: (requestsByUser.get(row.id) ?? []).map((request) => ({
          id: request.id,
          kind: request.kind,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
          completedAt: request.completedAt?.toISOString() ?? null,
        })),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
