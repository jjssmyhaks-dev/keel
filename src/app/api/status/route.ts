import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { envSettings } from "@/lib/policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database = false;
  let environments = 0;
  let mockOnly = true;

  try {
    environments = await db.environment.count();
    database = true;
    const rows = await db.environment.findMany({ select: { settingsJson: true, type: true } });
    mockOnly =
      rows.length > 0 && rows.every((row) => row.type === "development" || Boolean(envSettings(row).mockMode));
  } catch {
    database = false;
  }

  const liveEgress = process.env.KEEL_PROXY_LIVE === "1" && !mockOnly;

  return NextResponse.json(
    {
      status: database ? "operational" : "degraded",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      components: [
        {
          id: "control-plane",
          name: "Control plane",
          status: database ? "operational" : "degraded",
          detail: "Dashboard, API keys and session handling.",
        },
        {
          id: "database",
          name: "Metadata store",
          status: database ? "operational" : "degraded",
          detail: database ? `${environments} environments reachable.` : "Database check failed.",
        },
        {
          id: "proxy",
          name: "Agent proxy",
          status: database ? "operational" : "degraded",
          detail: liveEgress ? "Live egress enabled." : "Mock egress — provider calls are simulated.",
        },
        {
          id: "audit",
          name: "Audit pipeline",
          status: database ? "operational" : "degraded",
          detail: "Hash-chained writes and export.",
        },
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
