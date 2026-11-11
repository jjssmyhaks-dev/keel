import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processAuditSinks } from "@/lib/audit-sinks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(expected: string, provided: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("secret") || "";
  if (!sameSecret(secret, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processAuditSinks({ limit: 200 });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
