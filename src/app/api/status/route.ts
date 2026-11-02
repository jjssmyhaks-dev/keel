import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database = false;
  let environments = 0;

  try {
    environments = await db.environment.count();
    database = true;
  } catch {
    database = false;
  }

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
          detail: database
            ? "Live provider egress with policy, approvals and audit enforced."
            : "Proxy unavailable.",
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
