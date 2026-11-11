import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <aside className="relative hidden lg:flex flex-col justify-between bg-black text-white p-12 xl:p-16 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05] pointer-events-none">
          <svg width="100%" height="100%">
            <defs>
              <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>
        </div>
        <div className="absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full border border-white/[0.06]" />
        <div className="absolute -bottom-20 -right-20 w-[280px] h-[280px] rounded-full border border-white/[0.08]" />
        <div className="absolute bottom-24 right-24 w-[140px] h-[140px] rounded-full border border-[#eca8d6]/20" />

        <div className="relative z-10">
          <Link href="/" aria-label="Authab home">
            <Logo tone="light" className="text-2xl" />
          </Link>
        </div>

        <div className="relative z-10 max-w-md">
          <div className="mono-label text-white/35 mb-6">The agent control plane</div>
          <p className="font-display text-4xl xl:text-5xl leading-[1.02] text-white">
            Every agent gets an identity, a boundary and a paper trail.
          </p>
          <ul className="mt-12 space-y-4 font-mono text-[11px] text-white/45">
            <li className="flex items-center gap-3">
              <span className="w-1 h-1 rounded-full bg-[#eca8d6]" />
              Ed25519 identities · 5-minute tokens
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1 h-1 rounded-full bg-[#eca8d6]" />
              Vault credentials · proxy injection
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1 h-1 rounded-full bg-[#eca8d6]" />
              Human approvals · hash-chained audit
            </li>
          </ul>
        </div>

        <div className="relative z-10 flex items-center justify-between font-mono text-[10px] text-white/25">
          <span>© {new Date().getFullYear()} Authab Systems</span>
          <Link href="/status" className="flex items-center gap-2 hover:text-white/60 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#eca8d6]" />
            live status
          </Link>
        </div>
      </aside>

      <div className="relative flex flex-col min-h-screen">
        <header className="lg:hidden flex items-center justify-between px-6 h-16 border-b border-foreground/10">
          <Link href="/">
            <Logo className="text-xl" />
          </Link>
          <Link href="/sign-in" className="text-xs text-muted-foreground">
            Sign in
          </Link>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <footer className="px-6 py-6 text-center font-mono text-[10px] text-muted-foreground/60">
          <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
          <span className="mx-3">·</span>
          <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          <span className="mx-3">·</span>
          <Link href="/security" className="hover:text-foreground">Security</Link>
        </footer>
      </div>
    </div>
  );
}
