import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { CONNECTORS, connector } from "@/lib/connectors";
import { PageHeader, Panel, Stat, StatusBadge, relativeTime, EmptyState, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ connector?: string }>;
}) {
  const ctx = await getContext();
  const query = await searchParams;

  const credentials = await db.credential.findMany({
    where: {
      environmentId: ctx.environment.id,
      ...(query.connector ? { connectorSlug: query.connector } : {}),
    },
    include: {
      grants: { select: { agentId: true } },
      healthEvents: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const all = credentials;
  const healthy = all.filter((c) => c.status === "healthy" && !c.revokedAt).length;
  const attention = all.filter(
    (c) => c.status === "broken" || c.status === "expiring" || (c.expiresAt && c.expiresAt < new Date(Date.now() + 7 * 86400_000)),
  ).length;
  const usedConnectors = [...new Set(all.map((c) => c.connectorSlug))];

  return (
    <div>
      <PageHeader
        eyebrow="Vault · connections"
        title="The secret stays here."
        description="Credentials are sealed with envelope encryption. Agents never see them — the proxy injects them at the edge, one call at a time."
        actions={
          <Link href="/app/vault/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black">
            Add connection
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Connections" value={all.length} detail={`${usedConnectors.length} services`} accent />
        <Stat label="Healthy" value={healthy} detail="Token valid, scopes present" />
        <Stat label="Need attention" value={attention} detail={attention ? "Rotate or re-authorize" : "Nothing to fix"} />
        <Stat label="Granted" value={all.filter((c) => c.grants.length).length} detail="Connected to at least one agent" />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-black/10 pb-2 dark:border-border">
        <Link
          href="/app/vault"
          className={`border px-2.5 py-1 text-[11px] ${
            !query.connector ? "border-black bg-black text-white dark:border-foreground dark:bg-foreground dark:text-background" : "border-transparent text-black/55 hover:border-black/15 dark:text-muted-foreground"
          }`}
        >
          All
        </Link>
        {CONNECTORS.map((def) => {
          const count = all.filter((c) => c.connectorSlug === def.slug).length;
          if (!count) return null;
          return (
            <Link
              key={def.slug}
              href={`/app/vault?connector=${def.slug}`}
              className={`border px-2.5 py-1 text-[11px] ${
                query.connector === def.slug
                  ? "border-black bg-black text-white dark:border-foreground dark:bg-foreground dark:text-background"
                  : "border-transparent text-black/55 hover:border-black/15 dark:text-muted-foreground"
              }`}
            >
              {def.name} <span className="opacity-50">{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        {credentials.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {credentials.map((credential) => {
              const def = connector(credential.connectorSlug);
              const agents = new Set(credential.grants.map((grant) => grant.agentId)).size;
              const expiry = credential.expiresAt;
              return (
                <Link
                  key={credential.id}
                  href={`/app/vault/${credential.id}`}
                  className="group flex flex-col justify-between border border-black/10 bg-white p-4 transition-colors hover:border-black/30 dark:border-border dark:bg-card"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex size-8 items-center justify-center font-mono text-[10px] font-medium text-white"
                        style={{ background: def?.color ?? "#333" }}
                      >
                        {def?.mark ?? "??"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium">{credential.name}</p>
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
                          {def?.name ?? credential.connectorSlug}
                        </p>
                      </div>
                      <span className="ml-auto">
                        <StatusBadge status={credential.revokedAt ? "revoked" : credential.status} />
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between font-mono text-[10px] text-black/45 dark:text-muted-foreground">
                      <span>{credential.maskedHint || "••••"}</span>
                      <span>{credential.type}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-black/35 dark:border-border dark:text-muted-foreground">
                    <span>{agents} agent{agents === 1 ? "" : "s"}</span>
                    <span>{credential.lastUsedAt ? `used ${relativeTime(credential.lastUsedAt)}` : "never used"}</span>
                    <span>{expiry ? `expires ${formatDate(expiry)}` : "no expiry"}</span>
                  </div>
                  {credential.healthDetail ? (
                    <p className="mt-2 line-clamp-1 text-[10px] text-[#8c3225]">{credential.healthDetail}</p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : (
          <Panel bodyClassName="p-0">
            <EmptyState
              title="The vault is empty"
              description="Add a connection for Slack, GitHub, Stripe or any of the supported services. Secrets are encrypted before they touch the database."
              action={
                <Link href="/app/vault/new" className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                  Add the first connection
                </Link>
              }
            />
          </Panel>
        )}
      </div>

      <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-black/35 dark:text-muted-foreground">
        Master key → project key → per-credential data key · AES-256-GCM · every read logged
      </p>
    </div>
  );
}
