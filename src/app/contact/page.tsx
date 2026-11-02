import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to the Keel team about agents, security reviews, billing or support.",
};

const channels = [
  {
    label: "Sales and design partners",
    detail: "Production rollouts, Enterprise, regional deployments.",
    email: "hello@keel.dev",
    response: "One business day",
  },
  {
    label: "Support",
    detail: "A failing call, a stuck approval, an audit export.",
    email: "support@keel.dev",
    response: "Within 4 business hours",
  },
  {
    label: "Security",
    detail: "Vulnerability reports, compliance packs, NDA reviews.",
    email: "security@keel.dev",
    response: "Within 2 business days",
  },
  {
    label: "Billing",
    detail: "Invoices, GST details, plan changes, refunds.",
    email: "billing@keel.dev",
    response: "Two business days",
  },
];

export default function ContactPage() {
  return (
    <main className="relative">
      <Navigation />
      <section className="pt-32 lg:pt-40 pb-20">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/40 mb-6">Contact</p>
          <h1 className="font-display text-6xl leading-[0.9] tracking-tight lg:text-8xl">
            A human reads
            <br />
            <span className="text-foreground/35">every message.</span>
          </h1>
          <p className="mt-8 max-w-xl text-[16px] leading-relaxed text-foreground/60">
            No ticket maze. Tell us what broke, what you are building, or what your security team needs to sign off.
            Include a request id if you have one.
          </p>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-px border border-foreground/12 bg-foreground/10 md:grid-cols-2">
            {channels.map((channel) => (
              <a
                key={channel.email}
                href={`mailto:${channel.email}`}
                className="group bg-background p-6 lg:p-8 transition-colors hover:bg-foreground/[0.03]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="mono-label text-foreground/35">{channel.label}</p>
                    <p className="mt-3 text-lg font-medium">{channel.email}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground/55">{channel.detail}</p>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/35 group-hover:text-foreground">
                    Write →
                  </span>
                </div>
                <p className="mt-5 border-t border-foreground/10 pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/35">
                  Typical reply · {channel.response}
                </p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="mono-label text-foreground/40 mb-4">Office</p>
            <p className="text-[14px] leading-relaxed text-foreground/65">
              Keel Systems
              <br />
              Bengaluru, India
            </p>
            <p className="mt-4 text-[12px] text-foreground/40">
              Registered office details are available on request at{" "}
              <a href="mailto:legal@keel.dev" className="underline underline-offset-4">legal@keel.dev</a>.
            </p>
          </div>
          <div className="lg:col-span-8">
            <p className="mono-label text-foreground/40 mb-4">Before you write</p>
            <div className="grid gap-px border border-foreground/12 bg-foreground/10 sm:grid-cols-2">
              {[
                { title: "Debug a denied call", body: "The response includes a decision source and reason. The Activity page explains it months later.", href: "/docs/concepts/policy", label: "Policy docs" },
                { title: "Discuss Enterprise", body: "Custom volume, annual invoicing and security review. Ask for the current scope.", href: "/pricing", label: "Plans" },
                { title: "Report a vulnerability", body: "Follow the responsible disclosure policy and use security@keel.dev.", href: "/security#disclosure", label: "Disclosure" },
                { title: "Understand billing", body: "Usage meters, allowances and currency handling are documented on the billing page.", href: "/app/billing", label: "Billing" },
              ].map((item) => (
                <Link key={item.title} href={item.href} className="group bg-background p-5 hover:bg-foreground/[0.03]">
                  <p className="text-[14px] font-medium">{item.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-foreground/55">{item.body}</p>
                  <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/35 group-hover:text-foreground">
                    {item.label} →
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
