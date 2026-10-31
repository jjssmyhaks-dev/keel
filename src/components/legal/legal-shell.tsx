import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

const legalLinks = [
  { name: "Privacy", href: "/legal/privacy" },
  { name: "Terms", href: "/legal/terms" },
  { name: "Data processing", href: "/legal/dpa" },
  { name: "Responsible disclosure", href: "/security#disclosure" },
];

export function LegalShell({
  slug,
  eyebrow,
  title,
  intro,
  updated,
  children,
}: {
  slug: "privacy" | "terms" | "dpa";
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen">
      <Navigation />
      <div className="pt-28 lg:pt-36">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="grid gap-12 border-b border-foreground/10 pb-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end">
            <div className="order-2 lg:order-1">
              <p className="mono-label text-foreground/35 mb-3">Legal</p>
              <ul className="space-y-2">
                {legalLinks.map((link) => {
                  const active = link.href === `/legal/${slug}`;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className={`text-[13px] transition-colors ${
                          active
                            ? "text-foreground"
                            : "text-foreground/45 hover:text-foreground"
                        }`}
                      >
                        {link.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <p className="mono-label text-foreground/40 mb-4">{eyebrow}</p>
              <h1 className="font-display text-5xl leading-[0.95] tracking-tight lg:text-7xl">{title}</h1>
              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-foreground/60">{intro}</p>
              <p className="mono-label mt-6 text-foreground/30">Last updated · {updated}</p>
            </div>
          </div>

          <div className="grid gap-12 py-14 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-28 space-y-8">
                <div>
                  <p className="mono-label text-foreground/35 mb-3">Questions</p>
                  <p className="text-[12px] leading-relaxed text-foreground/50">
                    Legal questions go to{" "}
                    <a href="mailto:legal@keel.dev" className="underline underline-offset-4">legal@keel.dev</a>.
                    Security and data questions go to{" "}
                    <a href="mailto:security@keel.dev" className="underline underline-offset-4">security@keel.dev</a>.
                  </p>
                </div>
                <div className="border border-foreground/10 p-4">
                  <p className="mono-label text-foreground/35 mb-2">Plain English</p>
                  <p className="text-[12px] leading-relaxed text-foreground/55">
                    These documents are written to be read. If a clause is unclear, ask us before you sign or
                    deploy — we would rather explain it than argue about it later.
                  </p>
                </div>
              </div>
            </aside>
            <div className="docs-prose max-w-[760px]">{children}</div>
          </div>
        </div>
      </div>
      <FooterSection />
    </main>
  );
}
