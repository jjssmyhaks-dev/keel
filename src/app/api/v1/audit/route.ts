import { db } from "@/lib/db";
import { apiOk, authenticateApiKey, handleApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const agentId = url.searchParams.get("agent");
    const outcome = url.searchParams.get("outcome");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const before = url.searchParams.get("before");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

    const events = await db.auditEvent.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(action ? { action: { startsWith: action } } : {}),
        ...(agentId ? { agentId } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to
          ? {
              timestamp: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
        ...(before ? { seq: { lt: Number(before) } } : {}),
      },
      orderBy: { seq: order },
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;

    return apiOk({
      object: "list",
      data: page.map((event) => ({
        id: event.id,
        seq: event.seq,
        timestamp: event.timestamp.toISOString(),
        actor: { type: event.actorType, id: event.actorId, name: event.actorName },
        action: event.action,
        resource: { type: event.resourceType, id: event.resourceId },
        outcome: event.outcome,
        requestId: event.requestId,
        ip: event.ip,
        agentId: event.agentId,
        payload: JSON.parse(event.payloadSummary || "{}"),
        chain: JSON.parse(event.chainJson || "[]"),
        hash: event.hash,
        prevHash: event.prevHash,
      })),
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]?.seq : null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
