import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { inviteState } from "@/lib/invitations";
import { Logo } from "@/components/logo";
import { getSession, ROLE_META, type Role } from "@/lib/session";
import { acceptInviteAction } from "./actions";
import { switchAccountAction } from "./switch-account";

export const metadata: Metadata = { title: "Workspace invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { org: true },
  });

  if (!invitation) {
    return (
      <Shell>
        <h1 className="font-display text-5xl tracking-tight">This invitation is not valid.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Ask an owner or admin in the workspace to send a new invitation. Invitation links expire after seven days.
        </p>
        <Link href="/sign-in" className="mt-8 inline-flex border border-black bg-black px-5 py-3 font-mono text-xs uppercase tracking-widest text-white">
          Sign in to Keel
        </Link>
      </Shell>
    );
  }

  const role = (invitation.role as Role) in ROLE_META ? (invitation.role as Role) : "viewer";
  const session = await getSession();
  const { expired, accepted, emailMismatch, canAccept } = inviteState({
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    invitedEmail: invitation.email,
    sessionEmail: session?.user.email ?? null,
  });

  return (
    <Shell>
      <span className="border border-black/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
        Workspace invitation
      </span>
      <h1 className="mt-6 font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-[0.95] tracking-tight">
        Join {invitation.org.name}.
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        You were invited as <span className="font-medium text-foreground">{ROLE_META[role].label}</span>.{" "}
        {ROLE_META[role].description}
      </p>

      {query.error || expired || accepted || emailMismatch ? (
        <p className="mt-6 border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900">
          {accepted
            ? "This invitation has already been used. Sign in to open the workspace."
            : expired
              ? "This invitation expired. Ask an owner or admin to send a new one."
              : emailMismatch
                ? `This invitation was sent to ${invitation.email}. You are signed in as ${session!.user.email}.`
                : query.error === "email"
                  ? `Sign in with ${invitation.email} to accept this invitation.`
                  : query.error === "accepted"
                    ? "This invitation has already been used."
                    : query.error === "expired"
                      ? "This invitation expired. Ask an owner or admin to send a new one."
                      : "This invitation could not be accepted."}
        </p>
      ) : null}

      <div className="mt-10 grid gap-px border border-black/15 bg-black/15 md:grid-cols-2">
        <div className="bg-[var(--paper)] p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Invitation</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Workspace" value={invitation.org.name} />
            <Row label="Email" value={invitation.email} mono />
            <Row label="Role" value={ROLE_META[role].label} />
            <Row
              label="Expires"
              value={invitation.expiresAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            />
          </dl>
        </div>
        <div className="bg-white p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">What you get</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>The agents and connections shared with this workspace.</li>
            <li>The activity log, scoped to your role.</li>
            <li>Approvals, only if the role allows it.</li>
          </ul>

          {canAccept ? (
            <form action={acceptInviteAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full border border-black bg-black px-6 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black"
              >
                Accept invitation
              </button>
            </form>
          ) : emailMismatch ? (
            <form action={switchAccountAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full border border-black bg-black px-6 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white"
              >
                Sign out and switch account
              </button>
            </form>
          ) : !session && !expired && !accepted ? (
            <div className="mt-6 space-y-3">
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="block w-full border border-black bg-black px-6 py-3 text-center font-mono text-xs uppercase tracking-[0.18em] text-white"
              >
                Sign in to accept
              </Link>
              <Link
                href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="block w-full border border-black/25 px-6 py-3 text-center font-mono text-xs uppercase tracking-[0.18em]"
              >
                Create an account
              </Link>
              <p className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Use {invitation.email}
              </p>
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="mt-6 inline-block font-mono text-[10px] uppercase tracking-[0.2em] underline"
            >
              Sign in to Keel
            </Link>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-black/10 pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Keel home">
            <Logo tone="dark" />
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Workspace invitation
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-14 md:py-20">{children}</div>
      <footer className="mx-auto max-w-4xl px-6 pb-12 text-[11px] leading-relaxed text-muted-foreground">
        This link is single-purpose and expires after seven days. Keel never puts credentials in email.
      </footer>
    </main>
  );
}
