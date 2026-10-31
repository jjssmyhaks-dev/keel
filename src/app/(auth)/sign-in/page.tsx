import type { Metadata } from "next";
import { demoLoginEnabled } from "@/lib/demo";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, string> = {
  "password-reset": "Password updated. Sign in with your new password.",
  "oauth-not-configured": "Google and GitHub sign-in are not configured on this deployment. Use your email and password or a magic link.",
  "oauth-cancelled": "Sign-in was cancelled.",
  "oauth-state": "That sign-in attempt could not be verified. Please try again.",
  "oauth-failed": "We could not complete the provider sign-in. Try another method.",
  "account-deleted": "This account is scheduled for deletion.",
  "demo-disabled": "The demo workspace is disabled on this deployment.",
  "demo-unavailable": "The demo workspace is not seeded yet. Run npm run db:seed.",
  "magic-expired": "That sign-in link is invalid or has expired.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const { notice, next } = await searchParams;
  return (
    <div>
      {notice && notices[notice] && (
        <div className="mb-6 border border-foreground/15 bg-foreground/[0.03] px-4 py-3 text-[12px] text-muted-foreground">
          {notices[notice]}
        </div>
      )}
      <SignInForm next={next} demoEnabled={demoLoginEnabled()} />
    </div>
  );
}
