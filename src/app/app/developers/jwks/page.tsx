import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AUDIENCE, ISSUER, getJwks } from "@/lib/jwt";
import { CopyButton } from "@/components/app/copy-button";
import { PageHeader, Panel } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JWKS",
  description: "Public signing keys for verifying Authab agent tokens.",
};

export default async function JwksPage() {
  const jwks = await getJwks();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;

  const wellKnownUrl = `${origin}/.well-known/jwks.json`;
  const apiUrl = `${origin}/api/v1/jwks`;
  const document = JSON.stringify(jwks, null, 2);
  const primary = jwks.keys[0] as Record<string, unknown> | undefined;
  const kid = typeof primary?.kid === "string" ? primary.kid : "—";

  return (
    <div>
      <PageHeader
        eyebrow="Developers · JWKS"
        title="Verify tokens without calling home."
        description="Agent tokens are EdDSA JWTs. Fetch these public keys once and verify signatures locally; the private key never leaves the platform."
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
              href="/.well-known/jwks.json"
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
          { label: "Keys", value: String(jwks.keys.length), detail: "active signing keys" },
          { label: "Algorithm", value: "EdDSA", detail: "Ed25519" },
          { label: "Key ID", value: kid, detail: "matches the JWT header kid" },
        ].map((stat) => (
          <div key={stat.label} className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-black/60 dark:text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 truncate font-mono text-[13px] leading-none tracking-tight">{stat.value}</p>
            <p className="mt-1.5 font-mono text-[10px] text-black/60 dark:text-muted-foreground">{stat.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Signing key" hint="Public coordinate only" bodyClassName="p-4">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {(
                [
                  ["kty", primary?.kty],
                  ["crv", primary?.crv],
                  ["alg", primary?.alg],
                  ["use", primary?.use],
                  ["kid", primary?.kid],
                ] as [string, unknown][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-black/10 py-1.5 last:border-b-0 dark:border-border">
                  <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="font-mono text-[11px]">{typeof value === "string" ? value : "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  x — public key
                </p>
                <CopyButton value={typeof primary?.x === "string" ? primary.x : ""} label="Copy x" />
              </div>
              <pre className="mt-1.5 overflow-auto border border-black/10 bg-[#0b0b0b] p-3 font-mono text-[10px] leading-relaxed text-[#e8e6e1] dark:border-border">
                {typeof primary?.x === "string" ? primary.x : "—"}
              </pre>
            </div>
          </Panel>

          <Panel
            title="JSON Web Key Set"
            hint="Exactly what verifiers fetch"
            actions={<CopyButton value={document} label="Copy JSON" />}
            bodyClassName="p-0"
          >
            <pre className="max-h-[360px] overflow-auto bg-[#0b0b0b] p-4 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">
              {document}
            </pre>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Endpoints" hint="Same document, two paths" bodyClassName="p-0">
            <div className="divide-y divide-black/10 dark:divide-border">
              {[
                { label: "Well-known", url: wellKnownUrl, path: "/.well-known/jwks.json" },
                { label: "Platform API", url: apiUrl, path: "/api/v1/jwks" },
              ].map((endpoint) => (
                <div key={endpoint.path} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      {endpoint.label}
                    </p>
                    <CopyButton value={endpoint.url} label="Copy" />
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px]">{endpoint.url}</p>
                  <a
                    href={endpoint.path}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 underline-offset-2 hover:underline dark:text-muted-foreground"
                  >
                    Open raw ↗
                  </a>
                </div>
              ))}
            </div>
            <p className="border-t border-black/10 px-4 py-2.5 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
              Responses are cacheable for five minutes. Refetch on a <span className="font-mono">kid</span> miss instead of
              polling.
            </p>
          </Panel>

          <Panel title="Verify offline" hint="Node or edge, with jose" bodyClassName="p-0">
            <pre className="overflow-auto bg-[#0b0b0b] p-4 font-mono text-[10px] leading-relaxed text-[#e8e6e1]">{`import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(
  new URL("${wellKnownUrl}")
);

const { payload } = await jwtVerify(token, jwks, {
  issuer: "${ISSUER}",
  audience: "${AUDIENCE}",
  algorithms: ["EdDSA"],
});`}</pre>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <p className="text-[10px] text-black/60 dark:text-muted-foreground">
                Then check <span className="font-mono">payload.env</span> and{" "}
                <span className="font-mono">payload.scopes</span>.
              </p>
              <CopyButton
                value={`import { createRemoteJWKSet, jwtVerify } from "jose";\n\nconst jwks = createRemoteJWKSet(new URL("${wellKnownUrl}"));\n\nconst { payload } = await jwtVerify(token, jwks, {\n  issuer: "${ISSUER}",\n  audience: "${AUDIENCE}",\n  algorithms: ["EdDSA"],\n});`}
                label="Copy code"
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
