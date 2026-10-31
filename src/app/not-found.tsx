import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between px-6 lg:px-12">
          <Link href="/" aria-label="Keel home">
            <Logo />
          </Link>
          <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/50">
            <Link href="/docs" className="hover:text-foreground">Docs</Link>
            <Link href="/status" className="hover:text-foreground">Status</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-center px-6 py-24 lg:px-12">
        <p className="mono-label text-foreground/40 mb-6">404 · Not found</p>
        <h1 className="font-display text-6xl leading-[0.9] tracking-tight lg:text-8xl">
          This route has
          <br />
          <span className="text-foreground/35">no identity.</span>
        </h1>
        <p className="mt-8 max-w-xl text-[16px] leading-relaxed text-foreground/60">
          The page may have moved, been revoked, or never existed. Nothing was executed and no credential was touched.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-12 items-center bg-foreground px-6 text-sm font-medium text-background hover:bg-foreground/90"
          >
            Back to Keel
          </Link>
          <Link
            href="/docs"
            className="inline-flex h-12 items-center border border-foreground/20 px-6 text-sm hover:bg-foreground/5"
          >
            Read the docs
          </Link>
        </div>
      </section>

      <footer className="border-t border-foreground/10 px-6 py-6 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/35">
          <span>Keel Systems</span>
          <Link href="/status" className="hover:text-foreground">All systems monitored</Link>
        </div>
      </footer>
    </main>
  );
}
