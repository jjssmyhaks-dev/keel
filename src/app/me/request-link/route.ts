import { NextResponse } from "next/server";
import { clientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { csrfMatches, requestEndUserLoginLinks } from "@/lib/control-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const sent = (query: string) => NextResponse.redirect(new URL(`/me?${query}`, req.url), 303);
  if (!(await csrfMatches(form))) return sent("error=csrf");

  const ip = clientIp(req);
  const rate = await consumeRateLimit(`me:link:${ip ?? "unknown"}`, 5, 15 * 60_000);
  if (!rate.allowed) return sent("error=rate_limited");

  const email = String(form.get("email") ?? "").slice(0, 320);
  await requestEndUserLoginLinks(email).catch(() => 0);
  // Same response whether or not the address is on file: no account enumeration.
  return sent("sent=1");
}
