import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  approveConsentRequest,
  consentTokenHash,
  declineConsentRequest,
  isConsentDuration,
  riskRank,
} from "@/lib/consent";
import { db } from "@/lib/db";
import { ApiError, clientIp } from "@/lib/api";
import { constantTimeEqual } from "@/lib/crypto";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RISK_ORDER } from "@/lib/consent";
import type { Risk } from "@/lib/connectors";

export const dynamic = "force-dynamic";

function back(req: Request, token: string, error: string) {
  const url = new URL(`/consent/${encodeURIComponent(token)}`, req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const form = await req.formData();
  const csrf = String(form.get("csrf") ?? "");
  const cookieStore = await cookies();
  const expected = cookieStore.get("authab_csrf")?.value ?? "";
  if (!csrf || !expected || !constantTimeEqual(csrf, expected)) {
    return back(req, token, "csrf");
  }

  const ip = clientIp(req);
  const rate = await consumeRateLimit(`consent:decision:${ip ?? "unknown"}`, 30);
  if (!rate.allowed) return back(req, token, "rate_limited");

  const request = await db.consentRequest.findUnique({ where: { tokenHash: consentTokenHash(token) } });
  if (!request || request.status !== "pending" || request.expiresAt < new Date()) {
    return back(req, token, "request_closed");
  }

  if (form.get("decision") === "decline") {
    try {
      const result = await declineConsentRequest(request.id, ip);
      return NextResponse.redirect(result.redirectUrl, 303);
    } catch {
      return back(req, token, "request_closed");
    }
  }

  const duration = String(form.get("duration") ?? "");
  if (!isConsentDuration(duration)) return back(req, token, "invalid_duration");
  const selected = form
    .getAll("risks")
    .map(String)
    .filter((risk): risk is Risk => (RISK_ORDER as string[]).includes(risk))
    .sort((a, b) => riskRank(a) - riskRank(b));

  try {
    const result = await approveConsentRequest({
      requestId: request.id,
      selectedRisks: selected,
      duration,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.redirect(result.redirectUrl, 303);
  } catch (error) {
    if (error instanceof ApiError) {
      const known = new Set([
        "invalid_duration",
        "no_permissions",
        "connector_not_connected",
        "end_user_missing",
        "request_closed",
        "branding_incomplete",
      ]);
      return back(req, token, known.has(error.code) ? error.code : "unknown");
    }
    return back(req, token, "unknown");
  }
}
