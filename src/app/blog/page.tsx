import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { POSTS } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog — Keel",
  description: "Notes on agent identity, governance and audit from the Keel team.",
};

export default function BlogPage() {
  const [lead, ...rest] = POSTS;

  return (
    <main className="relative">
      <Navigation />
      <section className="pt-32 lg:pt-40 pb-16">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <p className="mono-label text-foreground/40 mb-6">Writing</p>
          <h1 className="font-display text-6xl leading-[0.9] tracking-tight lg:text-8xl">
            Notes from the
            <br />
            <span className="text-foreground/35">control plane.</span>
          </h1>
        </div>
      </section>

      <section className="pb-20">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          {lead ? (
            <Link href={`/blog/${lead.slug}`} className="group block border-y border-foreground/10 py-8 lg:py-12">
              <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
                <div className="lg:col-span-8">
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/40">
                    <span>{lead.kicker}</span>
                    <span>·</span>
                    <span>{lead.displayDate}</span>
                    <span>·</span>
                    <span>{lead.readMinutes} min read</span>
                  </div>
                  <h2 className="mt-5 max-w-3xl font-display text-4xl leading-[0.95] tracking-tight transition-colors group-hover:text-foreground/70 lg:text-6xl">
                    {lead.title}
                  </h2>
                </div>
                <p className="max-w-md text-[14px] leading-relaxed text-foreground/55 lg:col-span-4">{lead.description}</p>
              </div>
            </Link>
          ) : null}

          <div className="divide-y divide-foreground/10 border-b border-foreground/10">
            {rest.map((item) => (
              <Link key={item.slug} href={`/blog/${item.slug}`} className="group grid gap-4 py-8 transition-colors hover:bg-foreground/[0.02] lg:grid-cols-12">
                <div className="lg:col-span-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.16em] text-foreground/40">
                  {item.displayDate}
                  <br />
                  {item.readMinutes} min · {item.author}
                </div>
                <div className="lg:col-span-6">
                  <h2 className="font-display text-3xl leading-none tracking-tight group-hover:text-foreground/70">{item.title}</h2>
                  <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-foreground/55">{item.description}</p>
                </div>
                <div className="flex items-start justify-end lg:col-span-3">
                  <span className="border border-foreground/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/40 group-hover:border-foreground group-hover:text-foreground">
                    {item.kicker}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
