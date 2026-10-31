import { NextResponse } from "next/server";
import { getJwks } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=600",
      "content-type": "application/json",
    },
  });
}
