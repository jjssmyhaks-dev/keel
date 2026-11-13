import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Logo } from "@/components/logo";
import { headersClientIp } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { END_USER_COOKIE, endUserSessionWithUser } from "@/lib/consent";
import { endUserControlData } from "@/lib/control-center";

export const metadata: Metadata = {
  title: "Your control center",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const DATE = { dateStyle: "medium" as const, timeStyle: "short" as const };

export default async function ControlCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; revoked?: string; disconnected?: string; requested?: string }>;
}) {
  const query = await searchParams;
  const headerList = await headers();
  const ip = headersClientIp(headerList);
  if (ip) {
    const rate = await consumeRateLimit(`me:page:${ip}`, 120);
    if (!rate.allowed) {
      return (
        <Shell>
          <h1 className="font-display text-5xl tracking-tight">Too many visits.</h1>
          <p className="mt-4 text-sm text-muted-foreground">Wait a minute, then reload this page.</p>
        </Shell>
      );
    }
  }

  const store = await cookies();
  const session = await endUserSessionWithUser(store.get(END_USER_COOKIE)?.value);
  const csrf = store.get("authab_csrf")?.value ?? "";

  if (!session) {
    return (
      <Shell>
        <h1 className="font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-[0.95] tracking-tight">
          Every agent permission, in one place.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Products use Authab to let AI agents act for you. Sign in with the email you shared with them to see exactly what
          each agent may do, disconnect accounts, revoke access, and download or delete your data.
        </p>

        {query.sent ? (
          <p className="mt-6 border border-black/15 bg-white px-4 py-3 text-sm">
            If that email is on file, a single-use sign-in link is on its way. It expires in 15 minutes.
          </p>
        ) : null}
        {query.error === "link" ? (
          <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
            That sign-in link is invalid, expired, or already used. Request a new one.
          </p>
        ) : null}
        {query.error === "csrf" || query.error === "rate_limited" ? (
          <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
            {query.error === "csrf" ? "The page expired. Reload and try again." : "Too many attempts. Wait a few minutes."}
          </p>
        ) : null}

        <form method="POST" action="/me/request-link" className="mt-8 max-w-md border border-black/15 bg-white p-6">
          <input type="hidden" name="csrf" value={csrf} />
          <label htmlFor="email" className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Email used with the product
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="mt-2 w-full border border-black/15 bg-[var(--paper)] px-3 py-2.5 text-sm outline-none focus:border-black"
          />
          <button
            type="submit"
            className="mt-4 w-full border border-black bg-black px-5 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white"
          >
            Email me a sign-in link
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            We never say whether an address is on file. If you are not sure which email a product has, check that product&apos;s
            own account settings.
          </p>
        </form>
      </Shell>
    );
  }

  const data = await endUserControlData(session.endUser);
  const displayName = session.endUser.email ?? session.endUser.externalUserId;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Control center</span>
          <h1 className="mt-3 font-display text-[clamp(2.4rem,5vw,3.8rem)] leading-[0.95] tracking-tight">{displayName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.products.length
              ? `${data.products.reduce((sum, product) => sum + product.consents.length, 0)} active permission${data.products.reduce((sum, product) => sum + product.consents.length, 0) === 1 ? "" : "s"} across ${data.products.length} product${data.products.length === 1 ? "" : "s"}.`
              : "No product currently has an active permission for you."}
          </p>
        </div>
        <form method="POST" action="/me/logout">
          <input type="hidden" name="csrf" value={csrf} />
          <button type="submit" className="border border-black/25 px-4 py-2 text-xs font-mono uppercase tracking-[0.18em] hover:border-black">
            Sign out
          </button>
        </form>
      </div>

      {query.revoked ? (
        <p className="mt-6 border border-black/15 bg-white px-4 py-3 text-sm">
          Permission revoked. The agent lost access immediately; the decision is in the audit log.
        </p>
      ) : null}
      {query.disconnected ? (
        <p className="mt-6 border border-black/15 bg-white px-4 py-3 text-sm">
          Account disconnected. Credentials were destroyed and every agent grant for it expired.
        </p>
      ) : null}
      {query.requested === "delete" ? (
        <p className="mt-6 border border-black/15 bg-white px-4 py-3 text-sm">
          Deletion request recorded. The product&apos;s owners were notified and must complete it; the status appears below.
        </p>
      ) : null}
      {query.error && ["csrf", "credential", "consent", "rate_limited"].includes(query.error) ? (
        <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
          {query.error === "csrf"
            ? "The page expired. Reload and try again."
            : query.error === "rate_limited"
              ? "That action was rate-limited. Try again later."
              : "That item no longer belongs to you or was already removed."}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Permissions</h2>
        {data.products.length ? (
          <div className="mt-4 space-y-6">
            {data.products.map((product) => (
              <div key={product.projectId} className="border border-black/15 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 p-5">
                  <div>
                    <p className="font-display text-2xl tracking-tight">{product.productName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {product.supportUrl ? (
                        <a href={product.supportUrl} className="underline" rel="noopener noreferrer">
                          Support
                        </a>
                      ) : null}
                      {product.supportUrl && product.privacyUrl ? " · " : null}
                      {product.privacyUrl ? (
                        <a href={product.privacyUrl} className="underline" rel="noopener noreferrer">
                          Privacy
                        </a>
                      ) : null}
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-black/10">
                  {product.consents.map((consent) => (
                    <li key={consent.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                      <div className="max-w-xl">
                        <p className="text-sm font-medium">{consent.agentName}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{consent.actions.join(" · ")}</p>
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          Granted {consent.grantedAt.toLocaleString("en-IN", DATE)} ·{" "}
                          {consent.expiresAt ? `Expires ${consent.expiresAt.toLocaleString("en-IN", DATE)}` : "No expiry"}
                          {consent.lastUsedAt ? ` · Last used ${consent.lastUsedAt.toLocaleString("en-IN", DATE)}` : " · Never used"}
                        </p>
                      </div>
                      <form method="POST" action={`/me/revoke/${consent.id}`}>
                        <input type="hidden" name="csrf" value={csrf} />
                        <button
                          type="submit"
                          className="border border-black/25 px-4 py-2 text-xs font-mono uppercase tracking-[0.18em] hover:border-black"
                        >
                          Revoke
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 border border-black/15 bg-white p-6 text-sm text-muted-foreground">
            Nothing is active. When a product asks to act for you, the request appears here after you approve it.
          </p>
        )}
        {data.revokedConsentCount ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {data.revokedConsentCount} revoked or expired permission{data.revokedConsentCount === 1 ? "" : "s"} are kept in the
            audit log only.
          </p>
        ) : null}
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Connected accounts</h2>
        {data.connections.length ? (
          <ul className="mt-4 divide-y divide-black/10 border border-black/15 bg-white">
            {data.connections.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-medium">{connection.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection.account} ·{" "}
                    {connection.lastUsedAt
                      ? `Last used ${connection.lastUsedAt.toLocaleString("en-IN", DATE)}`
                      : "Never used"}
                  </p>
                </div>
                <form method="POST" action={`/me/disconnect/${connection.id}`}>
                  <input type="hidden" name="csrf" value={csrf} />
                  <button
                    type="submit"
                    className="border border-black/25 px-4 py-2 text-xs font-mono uppercase tracking-[0.18em] hover:border-black"
                  >
                    Disconnect
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border border-black/15 bg-white p-6 text-sm text-muted-foreground">No connected accounts.</p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recent agent activity</h2>
        {data.activity.length ? (
          <ul className="mt-4 divide-y divide-black/10 border border-black/15 bg-white">
            {data.activity.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{event.agentName}</span>{" "}
                  <span className="text-muted-foreground">
                    {event.action.toLowerCase()} on {event.connector}
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {event.outcome} · {event.at.toLocaleString("en-IN", DATE)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border border-black/15 bg-white p-6 text-sm text-muted-foreground">
            No agent has acted on your connections yet.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Activity shows what happened, never the content that was sent or returned.
        </p>
      </section>

      <section className="mt-12 border border-black/15 bg-white p-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Your data rights</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/me/export"
            className="border border-black bg-black px-5 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white"
          >
            Download my data
          </a>
          <form method="POST" action="/me/data/delete">
            <input type="hidden" name="csrf" value={csrf} />
            <button
              type="submit"
              className="border border-red-800/40 px-5 py-3 text-xs font-mono uppercase tracking-[0.18em] text-red-900 hover:border-red-800"
            >
              Request deletion
            </button>
          </form>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
          Downloads are created immediately and recorded with every product that holds your data. Deletion requests are sent to
          those products&apos; owners; deleting your data also revokes every permission above.
        </p>
        {data.dataRequests.length ? (
          <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
            {data.dataRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
                <span className="capitalize">{request.kind} request</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {request.status} · {request.createdAt.toLocaleString("en-IN", DATE)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="mt-10 text-[11px] leading-relaxed text-muted-foreground">
        This control center is independent of any single product. Authab emails one-time links; it never asks for a password
        here. <Link href="/" className="underline">About Authab</Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-[var(--paper)] text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Authab home">
            <Logo tone="dark" />
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">End-user control center</span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-14 md:py-20">{children}</div>
      <footer className="mx-auto max-w-4xl px-6 pb-12 text-[11px] leading-relaxed text-muted-foreground">
        Authab is the permission layer between you and AI agents. Revoking here takes effect on the next agent call.
      </footer>
    </main>
  );
}
