import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { loadConnectorMap } from "@/lib/custom-connectors";
import { PageHeader, Notice } from "@/components/app/ui";
import { ImportClient, type ConnectorOption } from "./import-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Import .env" };

export default async function ImportEnvPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; failed?: string }>;
}) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) redirect("/app/vault?error=permission");
  const query = await searchParams;
  const environmentLabel = ctx.environment.type === "production" ? "Production" : "Development";

  const connectorMap = await loadConnectorMap(ctx.environment.id);
  const connectors: ConnectorOption[] = [...connectorMap.values()]
    .filter((connector) => !connector.sandbox)
    .map((connector) => ({
      slug: connector.slug,
      name: connector.name,
      authTypes: connector.authMethods.map((method) => method.type),
      defaultAuth: connector.defaultAuth,
      fields: (connector.credentialFields ?? []).map((field) => ({
        key: field.key,
        label: field.label,
        required: Boolean(field.required),
        secret: Boolean(field.secret),
      })),
    }));

  const ids = (query.imported ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 20);
  const imported = ids.length
    ? await db.credential.findMany({
        where: { environmentId: ctx.environment.id, id: { in: ids } },
        select: { id: true, name: true, connectorSlug: true, maskedHint: true, type: true },
      })
    : [];

  return (
    <div>
      <PageHeader
        eyebrow={`Vault · import · ${environmentLabel}`}
        title="Bring the .env in."
        description="Upload or paste a .env file. Detection happens in your browser against the same pattern file the CLI uses; nothing is stored until you tick a row."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/vault"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Back to vault
            </Link>
            <Link
              href="/app/vault/new"
              className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
            >
              Add manually
            </Link>
          </div>
        }
      />

      {imported.length ? (
        <Notice kind="ok">
          Imported {imported.length} connection{imported.length === 1 ? "" : "s"} into {environmentLabel}.
          {query.failed ? ` ${query.failed} row${query.failed === "1" ? "" : "s"} could not be stored.` : ""} Grant an agent
          access from the permission matrix.
        </Notice>
      ) : null}
      {query.failed && !imported.length ? (
        <Notice kind="error">No connections were stored. Try the affected rows one at a time.</Notice>
      ) : null}

      {imported.length ? (
        <div className="mb-6 border border-black/10 bg-white dark:border-border dark:bg-card">
          {imported.map((credential) => (
            <div key={credential.id} className="flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-3 last:border-b-0 dark:border-border">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{credential.name}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                  {credential.connectorSlug} · {credential.type} · {credential.maskedHint || "••••"}
                </p>
              </div>
              <Link href={`/app/vault/${credential.id}`} className="font-mono text-[9px] uppercase tracking-[0.12em] underline">
                Open connection
              </Link>
              <Link href="/app/permissions" className="border border-black px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] hover:bg-black hover:text-white dark:border-border dark:hover:bg-white dark:hover:text-black">
                Grant an agent
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      <ImportClient
        connectors={connectors}
        environmentType={ctx.environment.type}
        productionWritable={ctx.capabilities.writeProduction}
      />

      <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
        Browser parsing · only confirmed rows sent · audit records variable names and connectors, never values
      </p>
    </div>
  );
}
