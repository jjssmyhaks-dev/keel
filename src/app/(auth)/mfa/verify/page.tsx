import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { MfaSessionForm } from "./session-form";

export const metadata: Metadata = { title: "Verify two-factor" };

export default async function MfaVerifyPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/mfa/verify");
  return (
    <div>
      <div className="mono-label text-muted-foreground mb-3">Second factor</div>
      <h1 className="text-4xl font-display tracking-tight leading-none">Verify this session.</h1>
      <p className="mt-3 mb-8 text-sm text-muted-foreground">
        Your organization requires multi-factor authentication. Enter a code from your authenticator to
        continue.
      </p>
      <MfaSessionForm />
    </div>
  );
}
