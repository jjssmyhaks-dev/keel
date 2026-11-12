import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, requireSecretKey } from "@/lib/api";
import { signPlatformJws } from "@/lib/jwt";
import {
  buildRevocationJwsPayload,
  nextAfter,
  revocationEntry,
  revocationsEtag,
} from "@/lib/revocations";

export const dynamic = "force-dynamic";

function cacheHeaders(etag: string) {
  return { ETag: `"${etag}"`, "Cache-Control": "private, max-age=30" };
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1000), 1), 5000);
    const cursor = url.searchParams.get("cursor")?.trim() || null;

    let since: Date | null = null;
    if (sinceRaw) {
      since = new Date(sinceRaw);
      if (Number.isNaN(since.getTime())) {
        throw new ApiError(422, "invalid_since", "since must be an ISO 8601 timestamp.");
      }
    }
    if (cursor) {
      const anchor = await db.revocation.findUnique({ where: { id: cursor }, select: { environmentId: true } });
      if (!anchor || anchor.environmentId !== auth.environment.id) {
        throw new ApiError(422, "invalid_cursor", "This cursor does not belong to the caller's environment.");
      }
    }

    const rows = await db.revocation.findMany({
      where: {
        environmentId: auth.environment.id,
        ...(since ? { revokedAt: { gte: since } } : {}),
      },
      orderBy: [{ revokedAt: "asc" }, { id: "asc" }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const revoked = rows.map(revocationEntry);
    const next = nextAfter(rows, limit);
    const etag = revocationsEtag(revoked);

    if (req.headers.get("if-none-match")) {
      const provided = (req.headers.get("if-none-match") ?? "")
        .split(",")
        .map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""));
      if (provided.includes(etag)) {
        return new Response(null, { status: 304, headers: cacheHeaders(etag) });
      }
    }

    const jws = await signPlatformJws(
      buildRevocationJwsPayload(revoked, { environmentType: auth.environment.type }) as unknown as Record<
        string,
        unknown
      >,
      "agent-revocations+jwt",
    );

    return apiOk({ jws, etag, next }, { headers: cacheHeaders(etag) });
  } catch (error) {
    return handleApiError(error);
  }
}
