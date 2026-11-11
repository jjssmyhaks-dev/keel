import { db } from "@/lib/db";
import { IMPACT_META, INCIDENT_STATUS_LABELS, isIncidentImpact, isIncidentStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  let incidents;
  try {
    incidents = await db.incident.findMany({
      where: {
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }],
      },
      include: { updates: { orderBy: { createdAt: "asc" } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
  } catch {
    return new Response("Status feed temporarily unavailable.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const entries = incidents.map((incident) => {
    const updatedAt = [incident.startedAt, incident.resolvedAt ?? new Date(0), ...incident.updates.map((u) => u.createdAt)]
      .reduce((latest, date) => (date > latest ? date : latest), incident.startedAt);
    const impact = isIncidentImpact(incident.impact) ? IMPACT_META[incident.impact].label : incident.impact;
    const timeline = [
      `Investigating — ${incident.startedAt.toISOString()}\n${incident.body}`,
      ...incident.updates.map(
        (update) =>
          `${isIncidentStatus(update.status) ? INCIDENT_STATUS_LABELS[update.status] : update.status} — ${update.createdAt.toISOString()}\n${update.body}`,
      ),
    ].join("\n\n");
    return `  <entry>
    <id>urn:authab:incident:${esc(incident.id)}</id>
    <title>${esc(`[${impact}] ${incident.title}`)}</title>
    <link href="${esc(`${base}/status`)}"/>
    <updated>${updatedAt.toISOString()}</updated>
    <category term="${esc(incident.component)}"/>
    <content type="text">${esc(timeline)}</content>
  </entry>`;
  });

  const latest = incidents.reduce(
    (date, incident) => {
      const candidates = [incident.startedAt, incident.resolvedAt ?? new Date(0), ...incident.updates.map((u) => u.createdAt)];
      const max = candidates.reduce((a, b) => (a > b ? a : b), incident.startedAt);
      return max > date ? max : date;
    },
    new Date(0),
  );

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`${base}/status`)}</id>
  <title>Authab status</title>
  <subtitle>Published Authab incidents and updates</subtitle>
  <link href="${esc(`${base}/status`)}"/>
  <link rel="self" href="${esc(`${base}/status/feed.xml`)}"/>
  <updated>${(latest.getTime() === 0 ? new Date() : latest).toISOString()}</updated>
  <author><name>Authab</name></author>
${entries.join("\n")}
</feed>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
