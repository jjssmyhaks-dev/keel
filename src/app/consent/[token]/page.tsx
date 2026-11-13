import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { loadConsentPage, parseStringArray } from "@/lib/consent";
import { headersClientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = {
  title: "Permission request",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  csrf: "Your session for this page expired. Reload the page and try again.",
  state: "The connection attempt expired or was tampered with. Start the connection again.",
  denied: "The account connection was cancelled. You can try again, or decline the request.",
  connector: "That connection is not part of this request.",
  not_configured: "This product has not finished configuring that connection yet. Ask them to contact support.",
  exchange: "The provider rejected the connection. Try again — if it keeps failing, contact the product's support.",
  missing_code: "The provider did not return an authorization code. Try connecting again.",
  connector_not_connected: "Connect every account before approving.",
  no_permissions: "Keep at least one permission group to approve this request.",
  invalid_duration: "Choose one of the offered durations and try again.",
  request_closed: "This request is no longer open. Ask the product to send a new one.",
  end_user: "The account record for this request is no longer available.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  unknown: "Something went wrong while recording your decision. Try again.",
};

export default async function ConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const headerList = await headers();
  const ip = headersClientIp(headerList);
  if (ip) {
    const rate = await consumeRateLimit(`consent:page:${ip}`, 120);
    if (!rate.allowed) {
      return (
        <Shell productName="Permission request">
          <h1 className="font-display text-5xl tracking-tight">Too many visits.</h1>
          <p className="mt-4 text-sm text-muted-foreground">Wait a minute, then reload this page.</p>
        </Shell>
      );
    }
  }

  const result = await loadConsentPage(token);
  if (result.state !== "pending") {
    const copy =
      result.state === "expired"
        ? {
            title: "This request has expired.",
            body: "Ask the product to send a fresh permission request.",
          }
        : result.state === "completed"
          ? {
              title: "This request was already handled.",
              body: "If you approved it, the product has what it needs. The control center shows and revokes every permission you have given.",
            }
          : {
              title: "This link is not valid.",
              body: "The request was withdrawn or the link was truncated. Ask the product to send a new one.",
            };
    return (
      <Shell productName="Permission request">
        <h1 className="font-display text-5xl tracking-tight">{copy.title}</h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        <Link
          href="/me"
          className="mt-8 inline-flex border border-black bg-black px-5 py-3 text-xs font-mono uppercase tracking-widest text-white"
        >
          Open your control center
        </Link>
      </Shell>
    );
  }

  const { data } = result;
  const csrf = (await cookies()).get("authab_csrf")?.value ?? "";
  const branding = data.branding;
  const requestedConnectors = parseStringArray(data.request.connectorSlugsJson);
  const connectorRows = data.connectors.map((entry) => {
    const group = data.groups.flatMap((item) => item.actions).find((action) => action.connector === entry.slug);
    return { ...entry, name: group?.connectorName ?? entry.slug };
  });
  for (const slug of requestedConnectors) {
    if (!connectorRows.some((entry) => entry.slug === slug)) {
      connectorRows.push({ slug, name: slug, connected: false, account: null });
    }
  }

  return (
    <Shell productName={branding.productName} logoDataUri={branding.logoDataUri} accent={branding.primaryColor}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: branding.primaryColor, border: `1px solid ${branding.primaryColor}55` }}
        >
          {branding.productName}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Permission request · expires {data.request.expiresAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      <h1 className="mt-6 font-display text-[clamp(2.4rem,5vw,4rem)] leading-[0.95] tracking-tight">
        {data.agent.name} wants to act for you in {branding.productName}.
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Nothing is shared yet. Review each permission group, connect the accounts this product will use, and decide what you
        allow. You can revoke everything later from the control center.
      </p>

      {query.connected ? (
        <p className="mt-6 border border-emerald-800/30 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {connectorRows.find((entry) => entry.slug === query.connected)?.name ?? query.connected} connected. Finish approving
          below.
        </p>
      ) : null}
      {query.error ? (
        <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
          {ERROR_COPY[query.error] ?? ERROR_COPY.unknown}
        </p>
      ) : null}

      <ConsentForm
        token={token}
        csrf={csrf}
        groups={data.groups}
        connectors={connectorRows}
        durationOptions={data.durationOptions}
        primaryColor={branding.primaryColor}
      />

      <section className="mt-10 border border-black/15 bg-white p-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">What you are agreeing to</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {branding.consentText ||
            `${branding.productName} will use its agent to perform the actions you keep above, only through the accounts you connect, until the permission expires or you revoke it.`}
        </p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Consent text version {branding.consentTextVersion}
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          {branding.supportUrl ? (
            <a href={branding.supportUrl} rel="noopener noreferrer" className="underline">
              Support
            </a>
          ) : null}
          {branding.privacyUrl ? (
            <a href={branding.privacyUrl} rel="noopener noreferrer" className="underline">
              Privacy policy
            </a>
          ) : null}
          <Link href="/me" className="underline">
            Your control center
          </Link>
        </div>
      </section>
    </Shell>
  );
}

function Shell({
  children,
  productName,
  logoDataUri,
  accent,
}: {
  children: React.ReactNode;
  productName: string;
  logoDataUri?: string | null;
  accent?: string;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-[var(--paper)] text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUri} alt="" className="h-7 w-auto" />
            ) : (
              <span className="font-display text-xl tracking-tight" style={accent ? { color: accent } : undefined}>
                {productName}
              </span>
            )}
            {logoDataUri ? <span className="text-sm font-medium">{productName}</span> : null}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Secured by Authab
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-14 md:py-20">{children}</div>
      <footer className="mx-auto max-w-4xl px-6 pb-12 text-[11px] leading-relaxed text-muted-foreground">
        Authab records this decision in a tamper-evident audit log. This page never shows credentials, and connecting an
        account does not share anything until you approve.
      </footer>
    </main>
  );
}
