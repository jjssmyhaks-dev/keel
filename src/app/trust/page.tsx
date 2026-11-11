import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { IDENTITY_PROVIDERS, SUBPROCESSORS, TRUST_UPDATED } from "@/lib/trust";

export const metadata: Metadata = {
  title: "Trust center",
  description:
    "Authab security posture, compliance status, subprocessors and data-handling commitments — stated plainly, including what is not finished.",
};

const notClaimed = [
  {
    title: "SOC 2 Type II",
    status: "Not certified",
    body: "We have not completed a SOC 2 Type II audit, and no report exists. We will publish the audit period and report availability here when an independent auditor has issued one. Until then, treat any SOC 2 claim about Authab as unsupported.",
  },
  {
    title: "Third-party penetration test",
    status: "Not completed",
    body: "No external penetration test has been performed on the hosted service yet. We will publish the test window, scope and a summary of findings and remediation here once it has been completed and retested.",
  },
  {
    title: "ISO 27001",
    status: "Not certified",
    body: "We do not hold an ISO 27001 certificate. Our controls are documented below so you can assess them directly rather than relying on a logo.",
  },
];

const controls = [
  {
    title: "Envelope encryption for credentials",
    body: "Every third-party secret is sealed with AES-256-GCM under a workspace envelope key before it reaches Postgres. The proxy decrypts only long enough to inject the credential upstream; no API returns plaintext secrets after creation.",
    href: "/docs/concepts/vault",
    link: "Vault architecture",
  },
  {
    title: "Hash-chained, append-only audit",
    body: "Each audit row carries the SHA-256 hash of its canonical body and the previous hash. A database trigger rejects every UPDATE, DELETE and TRUNCATE; retention pruning and restore are the only maintenance paths and run in an explicitly opted-in transaction.",
    href: "/docs/concepts/audit",
    link: "Audit chain",
  },
  {
    title: "Streaming to your SIEM",
    body: "Audit events deliver to signed webhooks or Splunk HEC with per-environment ordering, at-least-once delivery and exponential-backoff retries. You verify the HMAC and the chain independently.",
    href: "/app/security/streaming",
    link: "Audit streaming",
  },
  {
    title: "Human access controls",
    body: "Seven roles with per-membership capability grants, TOTP MFA with recovery codes, enforced MFA, OIDC and SAML SSO, and SCIM 2.0 provisioning and deprovisioning.",
    href: "/app/security",
    link: "Security settings",
  },
  {
    title: "Least privilege at call time",
    body: "Grants name the agent, connector, action, resource pattern and rate limit. High-risk actions require a signed approval. Production writes are a separate capability from development.",
    href: "/docs/concepts/grants",
    link: "Grants",
  },
  {
    title: "Egress that fails closed",
    body: "The proxy resolves and validates every upstream host, blocks private and link-local ranges by default, enforces per-agent call caps and records an audit event for each attempt — including failures.",
    href: "/docs/concepts/policy",
    link: "Policy engine",
  },
];

export default function TrustPage() {
  return (
    <main id="main-content" tabIndex={-1} className="relative">
      <Navigation />
      <section className="pt-32 lg:pt-40 pb-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/60 mb-6">Trust center</p>
          <h1 className="font-display text-[12vw] leading-[0.85] tracking-[-0.02em] lg:text-[8.5rem]">
            Evidence,
            <br />
            <span className="text-stroke">not badges.</span>
          </h1>
          <div className="mt-12 grid gap-8 border-t border-foreground/10 pt-8 lg:grid-cols-12">
            <p className="lg:col-span-4 mono-label text-foreground/60">Last reviewed · {TRUST_UPDATED}</p>
            <div className="lg:col-span-8 max-w-2xl space-y-4 text-[16px] leading-relaxed text-foreground/70">
              <p>
                This page states what is implemented, what is independently verified and what is still missing. It is
                updated when the facts change, not when a logo becomes available.
              </p>
              <p>
                Security questions, questionnaires and DPA requests go to{" "}
                <a href="mailto:security@authab.dev" className="underline underline-offset-4">security@authab.dev</a>.
                Report a vulnerability through our{" "}
                <Link href="/security#disclosure" className="underline underline-offset-4">responsible disclosure</Link>{" "}
                process.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-foreground/10 bg-foreground/[0.015] py-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/60 mb-6">Compliance status</p>
          <div className="grid gap-4 lg:grid-cols-3">
            {notClaimed.map((item) => (
              <div key={item.title} className="border border-foreground/12 bg-background p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-medium">{item.title}</h2>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#8c3225] dark:text-[#f0a396]">{item.status}</span>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-foreground/65">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/legal/dpa"
              className="inline-flex h-9 items-center border border-foreground/20 px-4 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-foreground"
            >
              Data processing agreement
            </Link>
            <Link
              href="/status"
              className="inline-flex h-9 items-center border border-foreground/20 px-4 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-foreground"
            >
              Live status and incidents
            </Link>
            <a
              href="/trust/subprocessors.json"
              className="inline-flex h-9 items-center border border-foreground/20 px-4 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-foreground"
            >
              Subprocessors.json
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="mono-label text-foreground/60 mb-4">Subprocessors</p>
              <h2 className="font-display text-4xl leading-tight">Who touches the data.</h2>
              <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-foreground/65">
                We give at least 30 days&apos; notice before adding a subprocessor that handles personal data. You may
                object on reasonable data-protection grounds. The same list is incorporated into the DPA.
              </p>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <div className="overflow-x-auto border border-foreground/12">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="border-b border-foreground/12 bg-foreground/[0.02] font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/60">
                    <tr>
                      <th className="px-4 py-3 font-normal">Subprocessor</th>
                      <th className="px-4 py-3 font-normal">Location</th>
                      <th className="px-4 py-3 font-normal">Purpose</th>
                      <th className="px-4 py-3 font-normal">Safeguards</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/10">
                    {SUBPROCESSORS.map((processor) => (
                      <tr key={processor.name} className="align-top">
                        <td className="px-4 py-3 font-medium">{processor.name}</td>
                        <td className="px-4 py-3 text-foreground/60">{processor.location}</td>
                        <td className="px-4 py-3 text-foreground/60">{processor.purpose}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-foreground/60">{processor.safeguards}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 border border-foreground/12 p-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/60">Optional identity providers</p>
                <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-foreground/65">
                  {IDENTITY_PROVIDERS.map((provider) => (
                    <li key={provider.name}>
                      <span className="font-medium text-foreground/70">{provider.name}</span> — {provider.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-foreground/10 py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="mono-label text-foreground/60 mb-4">Controls</p>
              <h2 className="font-display text-4xl leading-tight">Verifiable in the product.</h2>
              <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-foreground/65">
                Every control below ships in the codebase and is visible in a workspace or an audit export. Links point at
                the page or document that describes it.
              </p>
            </div>
            <div className="min-w-0 lg:col-span-8 divide-y divide-foreground/10 border-y border-foreground/10">
              {controls.map((control) => (
                <div key={control.title} className="grid gap-3 py-5 sm:grid-cols-[220px_1fr]">
                  <p className="text-[13px] font-medium">{control.title}</p>
                  <div>
                    <p className="text-[12px] leading-relaxed text-foreground/65">{control.body}</p>
                    <Link
                      href={control.href}
                      className="mt-2 inline-block font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/60 underline underline-offset-4 hover:text-foreground"
                    >
                      {control.link}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-foreground/10 py-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-8 lg:grid-cols-3">
          <div>
            <p className="mono-label text-foreground/60 mb-3">Data handling</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              Workspace data is processed only to provide the service. We do not sell it, use it for advertising or train
              models on it. Retention follows your plan, and deletion removes live data; billing records are kept for
              seven years as required by tax law.
            </p>
          </div>
          <div>
            <p className="mono-label text-foreground/60 mb-3">Encryption</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              TLS in transit, AES-256-GCM envelope encryption for credentials at rest, scrypt password hashing, SHA-256 for
              session and token lookups, and Ed25519 signatures for agent tokens. Database storage is encrypted at rest by
              our managed Postgres provider.
            </p>
          </div>
          <div>
            <p className="mono-label text-foreground/60 mb-3">Incident response</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              Confirmed customer-impacting incidents are published on the{" "}
              <Link href="/status" className="underline underline-offset-4">status page</Link> with time-stamped updates.
              Personal-data breaches are notified without undue delay, with the information you need to meet your own
              deadlines.
            </p>
          </div>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
