"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

const links = [
  { name: "Product", href: "/#capabilities" },
  { name: "Process", href: "/#process" },
  { name: "Runtime", href: "/#runtime" },
  { name: "Connectors", href: "/#connectors" },
  { name: "Security", href: "/#security" },
  { name: "Pricing", href: "/pricing" },
  { name: "Docs", href: "/docs" },
];

export function Navigation({ overlay = false }: { overlay?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const dark = overlay && !scrolled;
  const tone = dark ? "light" : "auto";

  return (
    <header
      className={`fixed z-50 transition-all duration-500 ${
        scrolled ? "top-4 left-4 right-4" : "top-0 left-0 right-0"
      }`}
    >
      <nav
        className={`mx-auto transition-all duration-500 ${
          scrolled || open
            ? "bg-background/85 backdrop-blur-xl border border-foreground/10 rounded-2xl shadow-lg max-w-[1240px]"
            : "bg-transparent max-w-[1400px]"
        }`}
      >
        <div
          className={`flex items-center justify-between px-5 lg:px-8 transition-all duration-500 ${
            scrolled ? "h-14" : "h-20"
          }`}
        >
          <Link href="/" aria-label="Authab home" className="flex items-center">
            <Logo tone={tone} className={`transition-all ${scrolled ? "text-xl" : "text-2xl"}`} />
          </Link>

          <div className="hidden lg:flex items-center gap-8">
            {links.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className={`text-[13px] transition-colors duration-300 relative group ${
                  dark ? "text-white/65 hover:text-white" : "text-foreground/65 hover:text-foreground"
                }`}
              >
                {link.name}
                <span
                  className={`absolute -bottom-1 left-0 w-0 h-px transition-all duration-300 group-hover:w-full ${
                    dark ? "bg-white" : "bg-foreground"
                  }`}
                />
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-5">
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className={`p-1.5 transition-colors ${dark ? "text-white/60 hover:text-white" : "text-foreground/60 hover:text-foreground"}`}
                aria-label="Toggle theme"
              >
                {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
            <Link
              href="/sign-in"
              className={`text-xs transition-colors ${dark ? "text-white/70 hover:text-white" : "text-foreground/70 hover:text-foreground"}`}
            >
              Sign in
            </Link>
            <Button
              asChild
              size="sm"
              className={`rounded-full h-9 px-5 text-xs transition-all duration-500 ${
                dark
                  ? "bg-white text-black hover:bg-white/90"
                  : "bg-foreground text-background hover:bg-foreground/90"
              }`}
            >
              <Link href="/sign-up">Start building</Link>
            </Button>
          </div>

          <button
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            className={`md:hidden p-2 ${open ? "text-foreground" : dark ? "text-white" : "text-foreground"}`}
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      <div
        id="mobile-menu"
        inert={!open}
        className={`md:hidden fixed inset-0 bg-background z-40 transition-all duration-500 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col h-full px-8 pt-28 pb-8">
          <div className="flex-1 flex flex-col justify-center gap-6">
            {links.map((link, i) => (
              <Link
                key={link.name}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`text-4xl font-display text-foreground transition-all duration-500 ${
                  open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
                style={{ transitionDelay: open ? `${i * 55}ms` : "0ms" }}
              >
                {link.name}
              </Link>
            ))}
          </div>
          <div
            className={`flex gap-4 pt-8 border-t border-foreground/10 transition-all duration-500 ${
              open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
            style={{ transitionDelay: open ? "320ms" : "0ms" }}
          >
            <Button asChild variant="outline" className="flex-1 rounded-full h-13">
              <Link href="/sign-in" onClick={() => setOpen(false)}>
                Sign in
              </Link>
            </Button>
            <Button asChild className="flex-1 bg-foreground text-background rounded-full h-13">
              <Link href="/sign-up" onClick={() => setOpen(false)}>
                Start building
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
