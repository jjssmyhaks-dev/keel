import type { Metadata } from "next";
import { demoLoginEnabled } from "@/lib/demo";
import { configuredProviders } from "@/lib/oauth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, string> = {
  "password-reset": "Password updated. Sign in with your new password.",
  "oauth-not-configured": "That sign-in method is not configured on this deployment. Use your email and password or a magic link.",
  "oauth-cancelled": "Sign-in was cancelled.",
  "oauth-state": "That sign-in attempt could not be verified. Please try again.",
  "oauth-failed": "We could not complete the provider sign-in. Try another method.",
  "account-deleted": "This account is scheduled for deletion.",
  "demo-disabled": "The demo workspace is disabled on this deployment.",
  "demo-unavailable": "The demo workspace is not seeded yet. Run npm run db:seed.",
  "magic-expired": "That sign-in link is invalid or has expired.",
  "sso-required": "Your organization requires SSO. Sign in with your identity provider.",
  "sso-disabled": "That SSO connection is disabled. Ask an owner to enable it.",
  "sso-domain": "That email domain is not allowed for this SSO connection.",
  "sso-suspended": "Your SSO account is suspended in this workspace. Contact an owner.",
  "sso-limit": "This workspace has reached its member limit. Ask an owner to upgrade the plan.",
  "sso-state": "That SSO sign-in could not be verified. Start again from the sign-in page.",
  "sso-config": "That SSO connection is misconfigured. Ask an owner to check the provider settings.",
  "sso-cancelled": "SSO sign-in was cancelled at the identity provider.",
  "sso-failed": "We could not complete SSO sign-in. If this keeps happening, ask an owner to check the connection.",
  "mfa-required": "Your organization requires multi-factor authentication. Sign in, then enroll to continue.",
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
      <SignInForm next={next} demoEnabled={demoLoginEnabled()} providers={configuredProviders()} />
    </div>
  );
}
