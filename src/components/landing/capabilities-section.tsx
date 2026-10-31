"use client";

import { useEffect, useRef, useState } from "react";
import { Fingerprint, Lock, ShieldCheck, FileClock } from "lucide-react";

const capabilities = [
  {
    number: "01",
    icon: Fingerprint,
    title: "Identity",
    description:
      "Every agent gets an Ed25519 key pair and a 5-minute token. No shared secrets, no static bearer keys, no impersonation.",
    detail: "EdDSA · JWKS · revocation",
  },
  {
    number: "02",
    icon: Lock,
    title: "Vault",
    description:
      "Credentials are sealed with envelope encryption. Agents borrow access through the proxy and never see the raw value.",
    detail: "AES-256-GCM · KMS-wrapped",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Governance",
    description:
      "Grants scope agents to actions and resources. Risky calls wait for a human. Every decision is written to an immutable log.",
    detail: "policy engine · approvals",
  },
  {
    number: "04",
    icon: FileClock,
    title: "Audit",
    description:
      "Hash-chained events for every token, call, approval and permission change. Export, stream and verify tamper evidence.",
    detail: "append-only · verifiable",
  },
];

function OrbitVisualization() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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

      const cx = w * 0.5;
      const cy = h * 0.5;
      const max = Math.min(w, h);

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (max / 11) * i, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2 + time * 0.08;
        const radius = max * (0.16 + ((i * 37) % 34) / 200);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.92;
        const twinkle = 0.25 + (Math.sin(time * 1.6 + i) * 0.5 + 0.5) * 0.75;
        ctx.beginPath();
        ctx.arc(x, y, i % 7 === 0 ? 2.2 : 1.3, 0, Math.PI * 2);
        ctx.fillStyle = i % 9 === 0 ? `rgba(236,168,214,${twinkle})` : `rgba(255,255,255,${twinkle * 0.5})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#eca8d6";
      ctx.fill();

      const ring = max * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, ring, time * 0.5, time * 0.5 + 1.4);
      ctx.strokeStyle = "rgba(236,168,214,0.45)";
      ctx.lineWidth = 1.25;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(time * 0.5 + 0.7) * ring,
        cy + Math.sin(time * 0.5 + 0.7) * ring,
        3,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "rgba(236,168,214,0.9)";
      ctx.fill();

      time += 0.012;
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export function CapabilitiesSection() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="capabilities" ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="relative mb-16 lg:mb-24">
          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
                <span className="w-12 h-px bg-foreground/30" />
                Capabilities
              </span>
              <h2
                className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                  visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
              >
                Identity.
                <br />
                <span className="text-muted-foreground">Then control.</span>
              </h2>
            </div>
            <div className="lg:col-span-5 lg:pb-4">
              <p
                className={`text-xl text-muted-foreground leading-relaxed transition-all duration-1000 delay-200 ${
                  visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
              >
                Four primitives that stop agents from becoming ungoverned API keys with
                a to-do list. Bring your own agent framework.
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-4 lg:gap-6">
          <div
            className={`lg:col-span-7 relative bg-black border border-foreground/10 min-h-[460px] overflow-hidden group transition-all duration-700 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
            }`}
            onMouseEnter={() => setActive(0)}
          >
            <OrbitVisualization />
            <div className="relative z-10 p-8 lg:p-12 max-w-md">
              <span className="font-mono text-sm text-white/40">{capabilities[0].number}</span>
              <h3 className="text-3xl lg:text-4xl font-display text-white mt-4 mb-6">
                {capabilities[0].title}
              </h3>
              <p className="text-lg text-white/55 leading-relaxed mb-8">
                {capabilities[0].description}
              </p>
              <span className="mono-label text-[#eca8d6]">{capabilities[0].detail}</span>
            </div>
            <div className="absolute right-8 bottom-8 z-10 hidden lg:flex flex-col items-end gap-2 font-mono text-[10px] text-white/30">
              <span>pub 9f2c:4a71:…:c81e</span>
              <span>alg EdDSA · crv Ed25519</span>
            </div>
          </div>

          <div className="lg:col-span-5 grid gap-4 lg:gap-6">
            {capabilities.slice(1).map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  onMouseEnter={() => setActive(index + 1)}
                  className={`group relative border border-foreground/10 p-7 lg:p-8 bg-foreground/[0.02] transition-all duration-700 hover:bg-foreground/[0.04] ${
                    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
                  }`}
                  style={{ transitionDelay: `${(index + 1) * 90}ms` }}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span className="font-mono text-xs text-muted-foreground">{item.number}</span>
                    <Icon
                      className={`w-5 h-5 transition-colors ${
                        active === index + 1 ? "text-[#eca8d6]" : "text-muted-foreground/60"
                      }`}
                    />
                  </div>
                  <h3 className="text-2xl lg:text-3xl font-display mb-3">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-6">{item.description}</p>
                  <span className="mono-label text-muted-foreground/70">{item.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
