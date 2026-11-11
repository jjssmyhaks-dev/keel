import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "About",
  description: "Why we build identity and governance for autonomous software.",
};

const principles = [
  {
    number: "01",
    title: "A secret is not an identity",
    body: "An API key cannot say who acted, why, or on whose behalf. It cannot be narrowed to one action or revoked without breaking everything else. Agents need principals, not borrowed keys.",
  },
  {
    number: "02",
    title: "Least privilege has to be usable",
    body: "Security that slows teams down gets bypassed. Grants must be editable in a click, visible in a matrix, and default-safe without becoming a second job.",
  },
  {
    number: "03",
    title: "Humans decide the irreversible",
    body: "Automation should move fast on reversible work and stop at the edge of money, deletion and public commitment. Approval is a control, not a bottleneck.",
  },
  {
    number: "04",
    title: "Proof over promises",
    body: "A log you can edit is a story. Every Authab environment keeps a hash-chained trail, and the product shows you how to verify it yourself.",
  },
];

const timeline = [
  { year: "2024", text: "Authab starts as an internal proxy for a support agent that had been given a production Slack token. The token was the incident." },
  { year: "2025", text: "The proxy grows identity, a vault and grants. The first design partners run it in front of Stripe and GitHub agents." },
  { year: "2026", text: "Environments, promotion and signed approvals ship. Authab becomes the control plane between agents and the systems they touch." },
];

export default function AboutPage() {
  return (
    <main id="main-content" tabIndex={-1} className="relative">
      <Navigation />
      <section className="pt-32 lg:pt-40 pb-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/60 mb-6">About</p>
          <h1 className="font-display text-[13vw] leading-[0.85] tracking-[-0.02em] lg:text-[9rem]">
            Agents need
            <br />
            <span className="text-stroke">a place</span> to belong.
          </h1>
          <div className="mt-12 grid gap-8 border-t border-foreground/10 pt-8 lg:grid-cols-12">
            <p className="lg:col-span-4 mono-label text-foreground/60">Authab Systems · Bengaluru</p>
            <div className="lg:col-span-8 max-w-2xl space-y-4 text-[16px] leading-relaxed text-foreground/70">
              <p>
                Software is no longer just executed. It decides, drafts, sends and pays. The tools we built for
                humans — sessions, roles, API keys — were never designed for a program that acts on its own schedule,
                on behalf of someone else, with access to money and communication.
              </p>
              <p>
                Authab is the missing layer: a place where an agent has an identity, a scoped set of powers, a vault it
                can use but not read, and a record of everything it did. We think that layer should be infrastructure,
                not a folder of environment variables.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24 border-y border-foreground/10 bg-foreground/[0.015]">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="mono-label text-foreground/60 mb-4">What we believe</p>
              <h2 className="font-display text-5xl leading-[0.95]">Four rules we do not bend.</h2>
            </div>
            <div className="lg:col-span-8 grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-2">
              {principles.map((principle) => (
                <div key={principle.number} className="bg-background p-6">
                  <p className="mono-label text-foreground/60">{principle.number}</p>
                  <h3 className="mt-4 text-lg font-medium">{principle.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-foreground/65">{principle.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="mono-label text-foreground/60 mb-4">How we got here</p>
            <h2 className="font-display text-5xl leading-[0.95]">One incident at a time.</h2>
          </div>
          <div className="lg:col-span-8 divide-y divide-foreground/10 border-y border-foreground/10">
            {timeline.map((item) => (
              <div key={item.year} className="grid gap-4 py-6 sm:grid-cols-[90px_1fr]">
                <p className="font-mono text-[12px] text-foreground/60">{item.year}</p>
                <p className="text-[15px] leading-relaxed text-foreground/70">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="flex flex-wrap items-center justify-between gap-5 border border-foreground/12 p-6 lg:p-8">
            <div>
              <p className="text-lg font-medium">Building agents that touch real systems?</p>
              <p className="mt-1 text-[13px] text-foreground/60">
                We work closely with design partners on financial, support and infrastructure agents.
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/contact" className="inline-flex h-10 items-center border border-foreground/20 px-5 text-[13px] hover:border-foreground">
                Talk to us
              </Link>
              <Link href="/docs/quickstart" className="inline-flex h-10 items-center bg-foreground px-5 text-[13px] text-background hover:bg-foreground/90">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CtaSection />
      <FooterSection />
    </main>
  );
}
