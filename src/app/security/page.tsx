import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "Security",
  description: "How Keel protects agent identity, credentials, approvals and the audit trail.",
};

const layers = [
  {
    label: "Identity",
    title: "Proof on every request",
    body: "Agents authenticate with Ed25519 keypairs and short-lived EdDSA JWTs. Tokens are bound to one agent and one environment, can be revoked before expiry, and are checked against a blocklist on every call.",
  },
  {
    label: "Vault",
    title: "Secrets agents cannot read",
    body: "Credentials use envelope encryption — a per-credential AES-256-GCM data key, wrapped by a per-project key, rooted in a deployment master key held outside the database. Plaintext exists only in memory during a proxied call.",
  },
  {
    label: "Policy",
    title: "Deny by default",
    body: "No grant, no call. Grants name exact actions and resources; conditions cover time windows, call caps and IP prefixes. Risk defaults escalate writes and financial actions to a human in production.",
  },
  {
    label: "Audit",
    title: "Tamper-evident by design",
    body: "Every event is appended to a per-environment SHA-256 hash chain. Verification is available in the dashboard and API, and exports preserve the chain columns so evidence survives outside Keel.",
  },
];

const practices = [
  ["Tenant isolation", "Every query is scoped by environment. Development and production share a policy model, never data, credentials, keys or audit chains."],
  ["Least privilege for operators", "Owner, admin, developer, approver and viewer roles are enforced server-side on every action. Production writes require an owner or admin and a verified email."],
  ["Secret handling", "Secrets are never returned by an API after creation, never written to logs, audit events or approval payloads, and never included in client bundles."],
  ["Session security", "Dashboard sessions are httpOnly, database-backed and individually revocable. API keys are stored hashed; only a prefix and last-used time remain."],
  ["Egress control", "The proxy builds URLs from connector definitions, not agent input. Live provider egress can be disabled at the deployment level."],
  ["Dependency hygiene", "Production builds are type-checked, dependency-audited and pinned. Security fixes ship as patch releases with a written summary."],
];

export default function SecurityPage() {
  return (
    <main className="relative">
      <Navigation />
      <section className="pt-32 lg:pt-40 pb-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/40 mb-6">Security</p>
          <h1 className="font-display text-6xl leading-[0.9] tracking-tight lg:text-8xl">
            Trust is a chain
            <br />
            <span className="text-foreground/35">of small proofs.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-[16px] leading-relaxed text-foreground/60">
            Keel holds the credentials and permissions your agents use. That makes our security model your security
            model, so we document it plainly: what is encrypted, what is enforced, what is logged, and what you can
            verify without taking our word for it.
          </p>
        </div>
      </section>

      <section className="py-8">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-px border border-foreground/12 bg-foreground/10 md:grid-cols-2">
            {layers.map((layer) => (
              <article key={layer.label} className="bg-background p-6 lg:p-8">
                <p className="mono-label text-foreground/35">{layer.label}</p>
                <h2 className="mt-4 font-display text-3xl leading-none">{layer.title}</h2>
                <p className="mt-3 text-[13px] leading-relaxed text-foreground/60">{layer.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="mono-label text-foreground/40 mb-4">In practice</p>
            <h2 className="font-display text-5xl leading-[0.95]">Controls, not slogans.</h2>
            <p className="mt-5 text-[13px] leading-relaxed text-foreground/50">
              These are properties of the product today. Our security page in the dashboard shows the guardrails
              active in your environment, including approval expiry, rate limits and egress mode.
            </p>
            <Link href="/app/security" className="mt-6 inline-flex h-10 items-center border border-foreground/20 px-5 text-[13px] hover:border-foreground">
              Open guardrails
            </Link>
          </div>
          <div className="lg:col-span-8 divide-y divide-foreground/10 border-y border-foreground/10">
            {practices.map(([title, body]) => (
              <div key={title} className="grid gap-3 py-5 sm:grid-cols-[180px_1fr]">
                <p className="text-[13px] font-medium">{title}</p>
                <p className="text-[13px] leading-relaxed text-foreground/55">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-foreground/10 bg-foreground/[0.015] py-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-8 lg:grid-cols-3">
          <div>
            <p className="mono-label text-foreground/40 mb-3">Compliance</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              We do not claim certifications we do not hold. Current audit status, subprocessors and the latest
              penetration-test summary are available to customers under NDA. Request them at{" "}
              <a href="mailto:security@keel.dev" className="underline underline-offset-4">security@keel.dev</a>.
            </p>
          </div>
          <div>
            <p className="mono-label text-foreground/40 mb-3">Data residency</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              The hosted service currently runs in Singapore (ap-southeast-1) on Neon Postgres, with encrypted backups
              in the same region. Enterprise deployments can choose a region; self-hosted deployments run entirely in
              your infrastructure.
            </p>
          </div>
          <div>
            <p className="mono-label text-foreground/40 mb-3">Incident response</p>
            <p className="text-[13px] leading-relaxed text-foreground/60">
              Confirmed customer-impacting incidents are acknowledged within one hour and updated at least every four
              hours. Post-incident reviews are written for every Sev-1 and shared with affected customers.            </p>
          </div>
        </div>
      </section>

      <section id="disclosure" className="py-20 lg:py-28 scroll-mt-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="mono-label text-foreground/40 mb-4">Responsible disclosure</p>
            <h2 className="font-display text-5xl leading-[0.95]">
              Found something?
              <br />
              Tell us first.
            </h2>
            <p className="mt-5 text-[13px] leading-relaxed text-foreground/55">
              Email <a href="mailto:security@keel.dev" className="underline underline-offset-4">security@keel.dev</a>.
              Encrypt with our PGP key on request. Include reproduction steps, affected endpoints and the earliest
              date you intend to publish.
            </p>
          </div>
          <div className="lg:col-span-8 space-y-6 text-[14px] leading-relaxed text-foreground/65">
            <div>
              <h3 className="font-medium text-foreground">Our commitments</h3>
              <ul className="mt-2 space-y-2">
                <li>We acknowledge every report within two business days and keep you updated until resolution.</li>
                <li>We will not pursue legal action for good-faith research that respects this policy and privacy.</li>
                <li>We fix confirmed issues before public disclosure and agree a timeline with you — normally 90 days.</li>
                <li>We credit researchers who want credit, and we do not pay for reports we did not solicit.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-foreground">In scope</h3>
              <p className="mt-2">
                The Keel dashboard, API, authentication flows and the agent proxy. Test only against workspaces you
                own, use demo data, and stop at the first proof of access.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-foreground">Out of scope</h3>
              <p className="mt-2">
                Denial of service, social engineering, physical attacks, spam, third-party providers, and reports
                produced solely by automated scanners without a demonstrated impact. Do not access another
                customer&apos;s data to prove a point.
              </p>
            </div>
            <div className="border-l-2 border-[#eca8d6] pl-4 text-[13px] text-foreground/55">
              We operate a safe harbour for research conducted under this policy. If a third party threatens you over
              compliant research, we will confirm publicly that the work was authorised.
            </div>
          </div>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
