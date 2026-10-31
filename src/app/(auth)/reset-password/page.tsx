import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div>
        <h1 className="text-4xl font-display tracking-tight mb-3">Link missing</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This page needs a reset token. Request a fresh link.
        </p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-4">
          Request a reset link
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}
