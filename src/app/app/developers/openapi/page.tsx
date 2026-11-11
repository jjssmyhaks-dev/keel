import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { buildOpenApiDocument } from "@/lib/openapi";
import { CopyButton } from "@/components/app/copy-button";
import { PageHeader, Panel } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OpenAPI",
  description: "The OpenAPI 3.1 document for this Authab deployment, rendered in the dashboard.",
};

type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: unknown;
};

type PathItem = Partial<Record<"get" | "post" | "patch" | "put" | "delete", Operation>>;

const METHOD_ORDER = ["get", "post", "patch", "put", "delete"] as const;

const METHOD_STYLE: Record<string, string> = {
  GET: "border-[#2f7d5c]/35 text-[#276a4e] dark:text-[#7fd1ab]",
  POST: "border-black/70 text-black dark:border-foreground/70 dark:text-foreground",
  PATCH: "border-[#a56b18]/40 text-[#8a5600] dark:text-[#e8b26a]",
  PUT: "border-[#a56b18]/40 text-[#8a5600] dark:text-[#e8b26a]",
  DELETE: "border-[#b3402f]/40 text-[#b3402f] dark:text-[#f09486]",
};

function authFor(security: unknown): string {
  if (Array.isArray(security) && security.length === 0) return "Public";
  const first =
    Array.isArray(security) && security[0] && typeof security[0] === "object"
      ? Object.keys(security[0] as Record<string, unknown>)
      : [];
  if (first.includes("bearerAgentToken")) return "Agent JWT";
  return "Secret key";
}

function collectOperations(paths: Record<string, PathItem>) {
  const operations: { method: string; path: string; summary: string; auth: string; tags: string[] }[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHOD_ORDER) {
      const operation = item[method];
      if (!operation) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.description ?? "",
        auth: authFor(operation.security),
        tags: operation.tags ?? ["Other"],
      });
    }
  }
  return operations;
}

export default async function OpenApiPage() {
  const spec = buildOpenApiDocument();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
  const rawUrl = `${origin}${spec.servers[0].url}/openapi`;

  const operations = collectOperations(spec.paths as Record<string, PathItem>);
  const tagOrder = spec.tags.map((tag) => tag.name);
  const tags = [...new Set([...tagOrder, ...operations.flatMap((operation) => operation.tags)])].filter((tag) =>
    operations.some((operation) => operation.tags.includes(tag)),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Developers · OpenAPI"
        title="The API contract, in the open."
        description="Every dashboard action maps to a documented endpoint. Generate a client, diff a release, or point your agent at the machine-readable document."
        actions={
          <>
            <Link
              href="/app/developers"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Developers
            </Link>
            <Link
              href="/docs/api"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              API docs
            </Link>
            <a
              href="/api/v1/openapi"
              target="_blank"
              rel="noreferrer"
              className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
            >
              Raw JSON ↗
            </a>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Specification", value: spec.openapi, detail: spec.info.title },
          { label: "Version", value: spec.info.version, detail: "info.version" },
          { label: "Operations", value: String(operations.length), detail: `${tags.length} groups` },
        ].map((stat) => (
          <div key={stat.label} className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-black/60 dark:text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 font-display text-2xl leading-none tracking-tight">{stat.value}</p>
            <p className="mt-1.5 font-mono text-[10px] text-black/60 dark:text-muted-foreground">{stat.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Endpoints" hint="Grouped by tag" bodyClassName="p-0">
            {tags.map((tag) => (
              <section key={tag} className="border-b border-black/10 last:border-b-0 dark:border-border">
                <header className="flex items-center justify-between bg-[#faf9f6] px-4 py-2 dark:bg-background">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/65 dark:text-muted-foreground">
                    {tag}
                  </h3>
                  <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                    {operations.filter((operation) => operation.tags.includes(tag)).length}
                  </span>
                </header>
                <div className="divide-y divide-black/10 dark:divide-border">
                  {operations
                    .filter((operation) => operation.tags.includes(tag))
                    .map((operation) => (
                      <div
                        key={`${operation.method} ${operation.path}`}
                        className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5"
                      >
                        <span
                          className={`mt-0.5 w-14 shrink-0 border px-1.5 py-0.5 text-center font-mono text-[8px] uppercase tracking-[0.12em] ${METHOD_STYLE[operation.method]}`}
                        >
                          {operation.method}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-all font-mono text-[11px]">{operation.path}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                            {operation.summary}
                          </p>
                        </div>
                        <span className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                          {operation.auth}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Server" hint="Relative to this deployment" bodyClassName="p-4">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all border border-black/10 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] dark:border-border dark:bg-background">
                {spec.servers[0].url}
              </code>
              <CopyButton value={rawUrl} label="Copy" />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Callers authenticate with <span className="font-mono">Authorization: Bearer sk_…</span>. The proxy also
              accepts short-lived agent JWTs.
            </p>
          </Panel>

          <Panel title="Authentication" hint="Two security schemes" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {Object.entries(spec.components.securitySchemes).map(([name, scheme]) => (
                <div key={name} className="px-4 py-3">
                  <p className="font-mono text-[10px]">{name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                    {scheme.description}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Use it" hint="Fetch the document" bodyClassName="p-0">
            <pre className="overflow-auto bg-[#0b0b0b] p-4 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">{`const spec = await fetch(
  "${rawUrl}"
).then((res) => res.json());

// Or generate a typed client
// npx openapi-typescript "${rawUrl}" -o api.d.ts`}</pre>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <p className="text-[10px] text-black/60 dark:text-muted-foreground">
                Public endpoint. No key required to read the schema.
              </p>
              <CopyButton value={rawUrl} label="Copy URL" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
