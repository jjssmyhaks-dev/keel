import type { Metadata } from "next";
import Link from "next/link";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div>
        <h1 className="text-4xl font-display tracking-tight mb-3">Verification link missing</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Open the link from your inbox, or resend it from Settings.
        </p>
        <Link href="/app/settings" className="text-sm underline underline-offset-4">
          Go to settings
        </Link>
      </div>
    );
  }
  return <VerifyEmailForm token={token} />;
}
