import { db } from "@/lib/db";
import { authenticateApiKey, clientIp, handleApiError } from "@/lib/api";
import { auditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "jsonl";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const agentId = url.searchParams.get("agent");
    const action = url.searchParams.get("action");

    const events = await db.auditEvent.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(agentId ? { agentId } : {}),
        ...(action ? { action: { startsWith: action } } : {}),
        ...(from || to
          ? {
              timestamp: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { seq: "asc" },
      take: 50_000,
    });

    await auditEvent({
      environmentId: auth.environment.id,
      actorType: "human",
      actorId: auth.apiKeyId,
      actorName: "API key",
      action: "audit.exported",
      resourceType: "audit",
      resourceId: null,
      outcome: "recorded",
      ip: clientIp(req),
      payloadSummary: { format, count: events.length, from, to },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `keel-audit-${auth.environment.type}-${stamp}.${format}`;
    let body: string;
    if (format === "csv") {
      const header = "seq,timestamp,actorType,actorName,action,resourceType,resourceId,outcome,requestId,agentId,ip,hash";
      const rows = events.map((event) =>
        [
          event.seq,
          event.timestamp.toISOString(),
          event.actorType,
          event.actorName,
          event.action,
          event.resourceType,
          event.resourceId,
          event.outcome,
          event.requestId,
          event.agentId,
          event.ip,
          event.hash,
        ]
          .map(csvCell)
          .join(","),
      );
      body = [header, ...rows].join("\n");
    } else {
      body = events
        .map((event) =>
          JSON.stringify({
            id: event.id,
            seq: event.seq,
            timestamp: event.timestamp.toISOString(),
            actor: { type: event.actorType, id: event.actorId, name: event.actorName },
            action: event.action,
            resource: { type: event.resourceType, id: event.resourceId },
            outcome: event.outcome,
            requestId: event.requestId,
            agentId: event.agentId,
            ip: event.ip,
            payload: JSON.parse(event.payloadSummary || "{}"),
            hash: event.hash,
            prevHash: event.prevHash,
          }),
        )
        .join("\n");
    }

    return new Response(body, {
      headers: {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-keel-export-count": String(events.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
