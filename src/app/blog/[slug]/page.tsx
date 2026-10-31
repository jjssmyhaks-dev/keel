import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { POSTS, post } from "@/lib/blog";

export function generateStaticParams() {
  return POSTS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = post(slug);
  if (!item) return { title: "Blog — Keel" };
  return { title: `${item.title} — Keel`, description: item.description };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = post(slug);
  if (!item) notFound();

  const index = POSTS.findIndex((entry) => entry.slug === slug);
  const next = POSTS[(index + 1) % POSTS.length];

  return (
    <main className="relative">
      <Navigation />
      <article className="pt-28 lg:pt-36 pb-20">
        <div className="mx-auto max-w-[820px] px-6 lg:px-12">
          <Link href="/blog" className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/40 hover:text-foreground">
            <ArrowLeft className="size-3" /> All writing
          </Link>
          <header className="mt-10 border-b border-foreground/10 pb-10">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/40">
              <span>{item.kicker}</span>
              <span>·</span>
              <span>{item.displayDate}</span>
              <span>·</span>
              <span>{item.readMinutes} min read</span>
            </div>
            <h1 className="mt-6 font-display text-5xl leading-[0.92] tracking-tight lg:text-7xl">{item.title}</h1>
            <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-foreground/60">{item.description}</p>
            <div className="mt-8 flex items-center gap-3">
              <span className="flex size-8 items-center justify-center bg-foreground font-mono text-[10px] text-background">
                {item.author.split(" ").map((part) => part[0]).join("")}
              </span>
              <div>
                <p className="text-[12px]">{item.author}</p>
                <p className="text-[10px] text-foreground/40">Keel Labs</p>
              </div>
            </div>
          </header>

          <div className="docs-prose mt-10">
            {item.body.map((block, blockIndex) => {
              if (block.type === "h2") return <h2 key={blockIndex}>{block.text}</h2>;
              if (block.type === "p") return <p key={blockIndex}>{block.text}</p>;
              if (block.type === "quote") return <blockquote key={blockIndex}>{block.text}</blockquote>;
              if (block.type === "code") return <pre key={blockIndex}>{block.text}</pre>;
              return (
                <ul key={blockIndex}>
                  {block.items.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              );
            })}
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/10 pt-6">
            <p className="text-[12px] text-foreground/40">Discuss this with us: hello@keel.dev</p>
            <Link href="/docs/quickstart" className="font-mono text-[9px] uppercase tracking-[0.16em] underline underline-offset-4">
              Start building
            </Link>
          </div>
        </div>
      </article>

      <section className="border-t border-foreground/10 py-12">
        <div className="mx-auto max-w-[820px] px-6 lg:px-12">
          <p className="mono-label text-foreground/35 mb-3">Next</p>
          <Link href={`/blog/${next.slug}`} className="group flex items-end justify-between gap-6">
            <h2 className="font-display text-3xl leading-none tracking-tight group-hover:text-foreground/70 lg:text-4xl">
              {next.title}
            </h2>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/40 group-hover:text-foreground">
              Read →
            </span>
          </Link>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
