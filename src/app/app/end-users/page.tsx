import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { PageHeader, Panel, Notice, EmptyState, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "End users" };

export default async function EndUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const search = (query.q ?? "").trim();

  const endUsers = await db.endUser.findMany({
    where: {
      projectId: ctx.project.id,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { externalUserId: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const ids = endUsers.map((row) => row.id);
  const [consents, credentials, dataRequests] = ids.length
    ? await Promise.all([
        db.consent.findMany({ where: { endUserId: { in: ids } }, select: { endUserId: true, revokedAt: true, expiresAt: true } }),
        db.credential.findMany({
          where: { endUserId: { in: ids }, revokedAt: null, environment: { projectId: ctx.project.id } },
          select: { endUserId: true },
        }),
        db.dataRequest.findMany({ where: { endUserId: { in: ids }, status: "open" }, select: { endUserId: true, kind: true } }),
      ])
    : [[], [], []];
  const now = new Date();
  const activeConsents = new Map<string, number>();
  for (const consent of consents) {
    if (!consent.endUserId) continue;
    if (!consent.revokedAt && (!consent.expiresAt || consent.expiresAt > now)) {
      activeConsents.set(consent.endUserId, (activeConsents.get(consent.endUserId) ?? 0) + 1);
    }
  }
  const connectionCounts = new Map<string, number>();
  for (const credential of credentials) {
    if (!credential.endUserId) continue;
    connectionCounts.set(credential.endUserId, (connectionCounts.get(credential.endUserId) ?? 0) + 1);
  }
  const openRequests = new Map<string, number>();
  for (const request of dataRequests) {
    openRequests.set(request.endUserId, (openRequests.get(request.endUserId) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace · people"
        title="The people behind the agents."
        description="End users who approved hosted consent for this project. Their connections never appear in the vault, and their data requests land here for an owner or admin to complete."
        actions={
          <Link
            href="/app/settings/consent"
            className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
          >
            Consent branding
          </Link>
        }
      />

      {query.deleted ? <Notice kind="ok">End-user data deleted. Consents were revoked and connections destroyed.</Notice> : null}
      {query.error ? (
        <Notice kind="error">
          {query.error === "permission" ? "Your role cannot change end-user data." : "That end user could not be found in this project."}
        </Notice>
      ) : null}

      <form method="GET" className="mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={search}
          placeholder="Search external user id or email"
          className="w-full max-w-sm border border-black/45 bg-white px-2.5 py-2 text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-card"
        />
        <button type="submit" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white dark:border-foreground dark:bg-foreground dark:text-background">
          Search
        </button>
        {search ? (
          <Link href="/app/end-users" className="self-center font-mono text-[10px] uppercase tracking-[0.14em] underline">
            Clear
          </Link>
        ) : null}
      </form>

      <Panel title="End users" hint={`${endUsers.length}${search ? " matching" : ""} · newest activity first`} bodyClassName="p-0">
        {endUsers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-black/10 font-mono text-[9px] uppercase tracking-[0.14em] text-black/55 dark:border-border dark:text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">External user</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Active consents</th>
                  <th className="px-4 py-2.5">Connections</th>
                  <th className="px-4 py-2.5">Requests</th>
                  <th className="px-4 py-2.5">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-border">
                {endUsers.map((endUser) => (
                  <tr key={endUser.id} className="hover:bg-[#faf9f6] dark:hover:bg-background">
                    <td className="px-4 py-3">
                      <Link href={`/app/end-users/${endUser.id}`} className="font-mono text-[11px] underline-offset-2 hover:underline">
                        {endUser.externalUserId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-black/65 dark:text-muted-foreground">{endUser.email ?? "—"}</td>
                    <td className="px-4 py-3">{activeConsents.get(endUser.id) ?? 0}</td>
                    <td className="px-4 py-3">{connectionCounts.get(endUser.id) ?? 0}</td>
                    <td className="px-4 py-3">
                      {openRequests.get(endUser.id) ? (
                        <span className="border border-[#b3402f]/35 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#b3402f]">
                          {openRequests.get(endUser.id)} open
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-black/65 dark:text-muted-foreground">{formatDate(endUser.lastSeenAt ?? endUser.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title={search ? "No matching end users" : "No end users yet"}
              description={
                search
                  ? "Try a different external user id or email."
                  : "End users appear when your product creates a consent request. Configure branding, then call POST /api/v1/consent/requests from your backend."
              }
              action={
                <Link href="/app/settings/consent" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white dark:border-foreground dark:bg-foreground dark:text-background">
                  Open consent settings
                </Link>
              }
            />
          </div>
        )}
      </Panel>

      <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
        Deleting an end user revokes every consent, expires every grant, destroys their stored connections and anonymizes the
        profile. The audit log keeps the event, never the deleted email.
      </p>
    </div>
  );
}
