import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { RISK_META } from "@/lib/connectors";
import { RISK_ORDER } from "@/lib/consent";
import { contrastRatio } from "@/lib/consent-branding";
import { PageHeader, Panel, Notice, formatDate } from "@/components/app/ui";
import { domainVerificationAction, saveConsentBrandingAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Consent branding" };

export default async function ConsentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const branding = await db.consentBranding.findUnique({ where: { projectId: ctx.project.id } });
  const canEdit = ctx.can("manage_agents");
  const redirects = branding ? (JSON.parse(branding.allowedRedirectUrisJson) as string[]) : [];
  const scopes = branding ? (JSON.parse(branding.allowedScopesJson) as string[]) : ["*"];
  const accent = branding?.primaryColor ?? "#111111";

  return (
    <div>
      <PageHeader
        eyebrow="Settings · hosted consent"
        title="Ask people for permission, plainly."
        description="End users see this branding on the hosted consent page. Nothing is requested until both this page and the consent API are configured; the control center at /me is always available."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/end-users"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              End users
            </Link>
            <a
              href="/me"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Control center
            </a>
          </div>
        }
      />

      {query.saved ? <Notice kind="ok">Consent branding saved.</Notice> : null}
      {query.verified ? <Notice kind="ok">Domain {query.verified} verified.</Notice> : null}
      {query.error ? (
        <Notice kind="error">
          {query.error === "permission" ? "Your role cannot change consent settings." : query.error}
        </Notice>
      ) : null}
      {query.record ? (
        <Notice kind="info">
          Publish this TXT record, then press “Check again”: <span className="font-mono">{query.record}</span> →{" "}
          <span className="font-mono">{query.token}</span>
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <form action={saveConsentBrandingAction} className="space-y-6" encType="multipart/form-data">
          <Panel title="Branding" hint="What the end user sees at the top of the request" bodyClassName="grid gap-4 p-4 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label htmlFor="productName" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Product name
              </label>
              <input
                id="productName"
                name="productName"
                required
                maxLength={80}
                defaultValue={branding?.productName ?? ctx.project.name}
                className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
            </div>
            <div>
              <label htmlFor="primaryColor" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Accent color (4.5:1 against white required)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="primaryColor"
                  name="primaryColor"
                  type="color"
                  defaultValue={accent}
                  className="h-9 w-12 border border-black/45 bg-white dark:border-white/40"
                />
                <span className="flex flex-1 items-center border border-black/10 px-2 font-mono text-[11px] dark:border-border">
                  {accent} · {contrastRatio(accent, "#ffffff").toFixed(1)}:1
                </span>
              </div>
            </div>
            <div>
              <label htmlFor="supportUrl" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Support URL
              </label>
              <input
                id="supportUrl"
                name="supportUrl"
                defaultValue={branding?.supportUrl ?? ""}
                placeholder="https://example.com/support"
                className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
            </div>
            <div>
              <label htmlFor="privacyUrl" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Privacy policy URL
              </label>
              <input
                id="privacyUrl"
                name="privacyUrl"
                defaultValue={branding?.privacyUrl ?? ""}
                placeholder="https://example.com/privacy"
                className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="logo" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Logo (PNG, JPEG or WebP · 200KB max)
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {branding?.logoDataUri ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={branding.logoDataUri} alt="" className="max-h-10 w-auto border border-black/10 bg-white p-1 dark:border-border" />
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-black/50 dark:text-muted-foreground">No logo</span>
                )}
                <input
                  id="logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="text-[12px] file:mr-3 file:border file:border-black/45 file:bg-white file:px-2 file:py-1.5 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.12em] dark:file:border-white/40 dark:file:bg-card"
                />
                {branding?.logoDataUri ? (
                  <label className="flex items-center gap-1.5 text-[11px] text-black/60 dark:text-muted-foreground">
                    <input type="checkbox" name="clearLogo" className="size-3 accent-black" /> Remove logo
                  </label>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="Consent text"
            hint={branding ? `Version ${branding.consentTextVersion} · changed ${formatDate(branding.updatedAt)}` : "Version 1 on first save"}
            bodyClassName="p-4"
          >
            <textarea
              id="consentText"
              name="consentText"
              rows={6}
              required
              maxLength={5000}
              defaultValue={
                branding?.consentText ??
                `${ctx.project.name} asks the agent you choose to act on your behalf, only through the accounts you connect, until the permission expires or you revoke it.`
              }
              className="w-full resize-y border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-black dark:border-white/40 dark:bg-background"
            />
            <p className="mt-2 text-[11px] text-black/55 dark:text-muted-foreground">
              The version saved with each consent is the version the end user saw. Editing the text creates a new version; it
              never rewrites history.
            </p>
          </Panel>

          <Panel title="Guardrails" hint="What this project may ever ask for" bodyClassName="grid gap-4 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="redirectUris" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Allowed redirect URIs (one per line)
              </label>
              <textarea
                id="redirectUris"
                name="redirectUris"
                rows={3}
                required
                defaultValue={redirects.join("\n")}
                placeholder="https://app.example.com/auth/callback"
                className="mt-1 w-full resize-y border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="allowedScopes" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Allowed scopes (one per line · “*” allows every connector action)
              </label>
              <textarea
                id="allowedScopes"
                name="allowedScopes"
                rows={3}
                required
                defaultValue={scopes.join("\n")}
                placeholder="gmail.*&#10;google_calendar.*"
                className="mt-1 w-full resize-y border border-black/45 bg-[#faf9f6] px-2.5 py-2 font-mono text-[11px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
            </div>
            <div>
              <label htmlFor="maxRisk" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Maximum risk
              </label>
              <select
                id="maxRisk"
                name="maxRisk"
                defaultValue={branding?.maxRisk ?? "write"}
                className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              >
                {RISK_ORDER.map((risk) => (
                  <option key={risk} value={risk}>
                    {RISK_META[risk].label} — {RISK_META[risk].description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="maxGrantDays" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                Maximum grant length (days)
              </label>
              <input
                id="maxGrantDays"
                name="maxGrantDays"
                type="number"
                min={1}
                max={365}
                defaultValue={branding?.maxGrantDays ?? 90}
                className="mt-1 w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
              />
              <p className="mt-1 text-[10px] text-black/55 dark:text-muted-foreground">
                “Until revoked” consents stop at this many days. Session consents last 24 hours.
              </p>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canEdit}
              className="border border-black bg-black px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-foreground dark:bg-foreground dark:text-background"
            >
              Save branding
            </button>
            {!canEdit ? (
              <span className="text-[11px] text-black/60 dark:text-muted-foreground">
                Your role can view this page but not change it.
              </span>
            ) : null}
          </div>
        </form>

        <div className="space-y-6">
          <Panel title="Domain verification" hint="Prove you own the consent origin" bodyClassName="space-y-3 p-4">
            {branding?.domainVerifiedAt ? (
              <p className="border border-[#2f7d5c]/30 bg-[#2f7d5c]/[0.06] px-3 py-2 text-[12px] text-[#245f47] dark:text-[#7fd1ab]">
                {branding.verifiedDomain} verified {formatDate(branding.domainVerifiedAt)}.
              </p>
            ) : branding?.verifiedDomain ? (
              <p className="text-[12px] text-black/65 dark:text-muted-foreground">
                {branding.verifiedDomain} is pending. Publish{" "}
                <span className="font-mono text-[11px]">_authab-verify.{branding.verifiedDomain}</span> with the TXT value
                generated below, then check again.
              </p>
            ) : (
              <p className="text-[12px] text-black/65 dark:text-muted-foreground">
                Verify the domain you embed the consent link on. Authab looks for a TXT record at{" "}
                <span className="font-mono text-[11px]">_authab-verify.&lt;domain&gt;</span>.
              </p>
            )}
            {branding?.domainVerificationToken && branding.verifiedDomain ? (
              <p className="break-all border border-black/10 bg-[#faf9f6] px-2.5 py-2 font-mono text-[10px] dark:border-border dark:bg-background">
                {branding.domainVerificationToken}
              </p>
            ) : null}
            <form action={domainVerificationAction} className="space-y-2">
              <input
                name="domain"
                defaultValue={branding?.verifiedDomain ?? ""}
                placeholder="app.example.com"
                disabled={!canEdit}
                className="w-full border border-black/45 bg-[#faf9f6] px-2.5 py-2 text-[12px] outline-none focus:border-black disabled:opacity-60 dark:border-white/40 dark:bg-background"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="intent"
                  value="start"
                  disabled={!canEdit}
                  className="border border-black/45 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-black disabled:opacity-40 dark:border-white/40"
                >
                  Generate record
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="check"
                  disabled={!canEdit || !branding?.domainVerificationToken}
                  className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-40 dark:border-foreground dark:bg-foreground dark:text-background"
                >
                  Check again
                </button>
              </div>
            </form>
          </Panel>

          <Panel title="Hosted surfaces" hint="Live routes this branding controls" bodyClassName="space-y-3 p-4 text-[12px]">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/50 dark:text-muted-foreground">Consent page</p>
              <p className="mt-1 break-all font-mono text-[11px]">/consent/&lt;token&gt;</p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/50 dark:text-muted-foreground">Control center</p>
              <p className="mt-1 break-all font-mono text-[11px]">/me</p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/50 dark:text-muted-foreground">Create a request</p>
              <p className="mt-1 break-all font-mono text-[11px]">POST /api/v1/consent/requests</p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/50 dark:text-muted-foreground">End-user API</p>
              <p className="mt-1 break-all font-mono text-[11px]">GET /api/v1/end-users</p>
            </div>
            <Link href="/app/developers/openapi" className="inline-block font-mono text-[10px] uppercase tracking-[0.14em] underline">
              API reference
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
