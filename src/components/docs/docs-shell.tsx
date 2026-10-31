import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { DocsMobileNav, DocsSidebar } from "./docs-nav";

export function DocsShell({
  eyebrow,
  title,
  intro,
  updated,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  updated?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen">
      <Navigation />
      <div className="pt-28 lg:pt-32">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,760px)_200px]">
            <aside className="hidden lg:block">
              <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-16 pr-4 scrollbar-thin">
                <DocsSidebar />
              </div>
            </aside>

            <div className="min-w-0 pb-24 lg:pb-32">
              <DocsMobileNav />
              <div className="border-b border-foreground/10 pb-8 mb-10">
                <p className="mono-label text-foreground/40 mb-4">{eyebrow}</p>
                <h1 className="font-display text-5xl lg:text-6xl leading-[0.95] tracking-tight">{title}</h1>
                {intro ? (
                  <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-foreground/60">{intro}</p>
                ) : null}
                {updated ? <p className="mono-label mt-6 text-foreground/30">Last updated · {updated}</p> : null}
              </div>
              <div className="docs-prose">{children}</div>
              <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/10 pt-6">
                <p className="text-[12px] text-foreground/45">Something missing? Write to docs@keel.dev.</p>
                <Link
                  href="/app/developers"
                  className="inline-flex items-center gap-2 text-[12px] text-foreground/60 hover:text-foreground"
                >
                  Open the dashboard <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </div>

            <aside className="hidden xl:block">
              <div className="sticky top-28 pb-16">{aside}</div>
            </aside>
          </div>
        </div>
      </div>
      <FooterSection />
    </main>
  );
}

export function DocsAside({ title = "On this page", links }: { title?: string; links: { href: string; name: string }[] }) {
  return (
    <div>
      <p className="mono-label text-foreground/35 mb-3">{title}</p>
      <ul className="space-y-2 border-l border-foreground/10">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="block pl-4 text-[12px] leading-snug text-foreground/50 hover:text-foreground">
              {link.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: "note" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-6 border border-foreground/12 bg-foreground/[0.02] p-4">
      <p className="mono-label mb-2" style={{ color: tone === "warning" ? "#8c3225" : "var(--foreground)" }}>
        {title}
      </p>
      <div className="text-[13px] leading-relaxed text-foreground/65">{children}</div>
    </div>
  );
}
