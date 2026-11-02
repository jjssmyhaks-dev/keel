import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { PricingSection } from "@/components/landing/pricing-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple usage-based pricing for agent identity, vault and governance. USD and INR.",
};

const faqs = [
  {
    q: "Is production mode really locked on Free?",
    a: "Yes. Free is a complete development environment — identity, vault, policy engine and audit — but production promotion requires Pro. We do this so nobody ships an unverified email address into production.",
  },
  {
    q: "What counts as a proxy call?",
    a: "Any request routed through the Keel proxy, including named actions and raw proxied requests. Token issuance, introspection and audit reads are free.",
  },
  {
    q: "What happens when I reach my limit?",
    a: "The allowance is enforced, not billed over. Once a workspace reaches its monthly call, agent or connection limit, the extra request is refused with a 402 response until the period resets or the plan changes. We do not add surprise overage charges.",
  },
  {
    q: "Can I pay in INR?",
    a: "Yes. Choose INR in Billing and Stripe checkout charges the INR price; international customers pay in USD. Paid plans activate as soon as Stripe confirms the subscription, and invoices appear in Billing.",
  },
  {
    q: "What happens when I downgrade?",
    a: "You keep read access to everything. Production calls are paused until you either return to Pro or move agents back to development.",
  },
  {
    q: "Do you offer a startup or nonprofit discount?",
    a: "We offer 50% off Pro for the first year for pre-seed startups and registered nonprofits. Email hello@keel.dev.",
  },
];

export default function PricingPage() {
  return (
    <main className="relative">
      <Navigation />
      <div className="pt-24">
        <PricingSection standalone />
      </div>

      <section className="pb-24 lg:pb-32">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-4">
              <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
                <span className="w-12 h-px bg-foreground/30" />
                Questions
              </span>
              <h2 className="text-5xl lg:text-6xl font-display tracking-tight leading-[0.95]">
                Before you
                <br />
                <span className="text-muted-foreground">upgrade.</span>
              </h2>
            </div>
            <div className="lg:col-span-8 divide-y divide-foreground/10 border-y border-foreground/10">
              {faqs.map((faq) => (
                <details key={faq.q} className="group py-6">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                    <span className="text-lg font-medium">{faq.q}</span>
                    <span className="text-muted-foreground font-mono text-xl leading-none group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border border-foreground/10 p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
              Need custom volume, annual invoicing or a security review?{" "}
              <span className="text-foreground">Talk to us about Enterprise.</span>
            </p>
            <div className="flex gap-3">
              <Link
                href="/contact"
                className="inline-flex items-center h-10 px-5 text-sm border border-foreground/20 hover:border-foreground transition-colors"
              >
                Contact sales
              </Link>
              <Link
                href="/docs/quickstart"
                className="inline-flex items-center h-10 px-5 text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors"
              >
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
