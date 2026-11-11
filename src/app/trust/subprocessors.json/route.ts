import { SUBPROCESSORS, TRUST_UPDATED } from "@/lib/trust";

export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      lastReviewed: TRUST_UPDATED,
      noticeDays: 30,
      subprocessors: SUBPROCESSORS,
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
