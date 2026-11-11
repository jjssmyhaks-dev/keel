import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { getSession } from "@/lib/session";
import { MfaChallengeForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    const session = await getSession();
    if (session) redirect("/mfa/verify");
    return (
      <div>
        <div className="mono-label text-muted-foreground mb-3">Second factor</div>
        <h1 className="text-4xl font-display tracking-tight leading-none">Start from sign in.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This challenge has no token. Sign in again to receive a fresh one.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block border border-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:bg-foreground hover:text-background"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  const record = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  const usable =
    record &&
    record.type === "mfa_challenge" &&
    !record.usedAt &&
    record.expiresAt > new Date() &&
    record.userId;
  if (!usable) {
    return (
      <div>
        <div className="mono-label text-muted-foreground mb-3">Second factor</div>
        <h1 className="text-4xl font-display tracking-tight leading-none">That challenge expired.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Two-factor challenges last ten minutes. Sign in again to get a new one.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block border border-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:bg-foreground hover:text-background"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  return <MfaChallengeForm token={token} />;
}
