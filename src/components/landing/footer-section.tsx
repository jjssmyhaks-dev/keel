"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";

const footerLinks = {
  Product: [
    { name: "Capabilities", href: "/#capabilities" },
    { name: "Policy engine", href: "/#policy" },
    { name: "Connectors", href: "/#connectors" },
    { name: "Pricing", href: "/pricing" },
  ],
  Developers: [
    { name: "Documentation", href: "/docs" },
    { name: "Quickstart", href: "/docs/quickstart" },
    { name: "API reference", href: "/docs/api" },
    { name: "Status", href: "/status" },
  ],
  Company: [
    { name: "About", href: "/about" },
    { name: "Security", href: "/security" },
    { name: "Trust center", href: "/trust" },
    { name: "Blog", href: "/blog" },
    { name: "Contact", href: "/contact" },
  ],
  Legal: [
    { name: "Privacy", href: "/legal/privacy" },
    { name: "Terms", href: "/legal/terms" },
    { name: "DPA", href: "/legal/dpa" },
    { name: "Responsible disclosure", href: "/security#disclosure" },
  ],
};

const socials = [
  { name: "GitHub", href: "https://github.com/jjssmyhaks-dev/keel" },
  { name: "Status", href: "/status" },
  { name: "Security", href: "/security" },
];

function Horizon() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let time = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const horizon = h * 0.62;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(236,168,214,0.10)");
      grad.addColorStop(0.55, "rgba(236,168,214,0.03)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (let line = 0; line < 3; line++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y =
            horizon +
            Math.sin(x * 0.006 + time * 0.6 + line * 0.9) * (22 - line * 5) +
            Math.sin(x * 0.017 + time + line) * 8;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(236,168,214,${0.26 - line * 0.07})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let i = 0; i < 46; i++) {
        const x = ((i * 137.5) % w) + Math.sin(time + i) * 12;
        const y = h * 0.08 + ((i * 53.7) % (h * 0.6));
        const a = 0.08 + (Math.sin(time * 1.4 + i * 2.1) * 0.5 + 0.5) * 0.22;
        ctx.beginPath();
        ctx.arc(x, y, i % 11 === 0 ? 1.5 : 0.8, 0, Math.PI * 2);
        ctx.fillStyle = i % 9 === 0 ? `rgba(236,168,214,${a})` : `rgba(255,255,255,${a * 0.5})`;
        ctx.fill();
      }

      time += 0.012;
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} className="w-full h-full" />;
}

export function FooterSection() {
  return (
    <footer className="relative bg-black text-white">
      <div className="relative w-full h-[260px] md:h-[330px] overflow-hidden">
        <Horizon />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60" />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            <div className="col-span-2">
              <Link href="/" className="inline-flex items-center gap-2 mb-6">
                <Logo tone="light" />
              </Link>
              <p className="text-white/60 leading-relaxed mb-8 max-w-[280px] text-sm">
                Identity, vault and governance for AI agents. Built for teams that ship
                agents to real customers.
              </p>
              <div className="flex gap-6">
                {socials.map((s) => (
                  <a
                    key={s.name}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-white/60 hover:text-white transition-colors flex items-center gap-1 group"
                  >
                    {s.name}
                    <ArrowUpRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                ))}
              </div>
            </div>

            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium text-white mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="text-sm text-white/60 hover:text-white transition-colors inline-flex items-center gap-2"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="py-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/60">© {new Date().getFullYear()} Authab Systems. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-6 text-sm text-white/60">
            <Link href="/status" className="hover:text-white transition-colors">
              Live status
            </Link>
            <span className="font-mono text-[11px]">Bengaluru, India</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
