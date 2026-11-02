"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, KeyRound, ShieldCheck, Timer, EyeOff, GitBranch, Globe2, ScrollText } from "lucide-react";

const features = [
  { icon: KeyRound, title: "Envelope encryption", body: "Every secret has its own data key. Project keys wrap data keys. A master key from your secret manager wraps project keys." },
  { icon: Timer, title: "Five-minute tokens", body: "Agent tokens expire by default, and every request checks the shared blocklist, so a killed agent stays dead." },
  { icon: EyeOff, title: "No raw reveal", body: "The vault shows a masked last-four and nothing else. Raw key reveal is opt-in, admin-approved and audited." },
  { icon: GitBranch, title: "Hash-chained log", body: "Each audit event commits the hash of the one before it. Verify any window and detect tampering." },
  { icon: Globe2, title: "Host allow-lists", body: "Credentials only travel to hosts declared in the connector manifest. No arbitrary exfiltration." },
  { icon: ScrollText, title: "Retention policy", body: "7 days on free, 90 on Pro, a year on Scale, custom on enterprise. Export to CSV or JSONL, or stream via webhooks." },
];

const controls = ["AES-256-GCM", "Ed25519 identity", "Hash-chained audit", "Audit export"];

export function SecuritySection() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.1,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setActive((v) => (v + 1) % features.length), 3200);
    return () => clearInterval(interval);
  }, []);

  const ActiveIcon = features[active].icon;

  return (
    <section id="security" ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="mb-16 lg:mb-24">
          <span
            className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 transition-all duration-700 ${
              visible ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="w-12 h-px bg-foreground/20" />
            Security
          </span>
          <h2
            className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] mb-10 transition-all duration-1000 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            Autonomous,
            <br />
            <span className="text-muted-foreground">not uncontrolled.</span>
          </h2>
          <p
            className={`text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-2xl transition-all duration-1000 delay-100 ${
              visible ? "opacity-100" : "opacity-0"
            }`}
          >
            Agents are powerful when they can act and dangerous when they can act
            anywhere. Keel makes the blast radius explicit, observable and small.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-4 lg:gap-6">
          <div
            className={`lg:col-span-5 relative border border-foreground/10 bg-black text-white p-8 lg:p-12 min-h-[420px] overflow-hidden transition-all duration-700 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <div className="absolute -right-16 -bottom-16 w-64 h-64 rounded-full border border-white/[0.06]" />
            <div className="absolute -right-6 -bottom-6 w-40 h-40 rounded-full border border-white/[0.08]" />
            <div className="absolute right-12 bottom-12 w-20 h-20 rounded-full border border-[#eca8d6]/20" />

            <span className="font-mono text-xs text-white/40">Active protection</span>
            <div className="mt-10">
              <span className="text-7xl lg:text-8xl font-display">0</span>
              <span className="block text-white/40 mt-2 text-sm">secrets exposed to an agent process</span>
            </div>

            <div className="relative z-10 mt-14 transition-opacity duration-500">
              <ActiveIcon className="w-6 h-6 text-[#eca8d6] mb-4" />
              <div className="text-xl font-display mb-2">{features[active].title}</div>
              <p className="text-sm text-white/50 leading-relaxed max-w-sm">{features[active].body}</p>
            </div>

            <div className="absolute bottom-8 left-8 right-8 flex flex-wrap gap-2">
              {controls.map((c, i) => (
                <span
                  key={c}
                  className={`px-3 py-1 border border-white/15 text-[10px] font-mono text-white/45 transition-all duration-500 ${
                    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: `${i * 100 + 300}ms` }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4 lg:gap-6">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  onMouseEnter={() => setActive(i)}
                  className={`border p-7 lg:p-8 transition-all duration-700 ${
                    active === i
                      ? "border-foreground/40 bg-foreground/[0.03]"
                      : "border-foreground/10 bg-transparent"
                  } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <Icon
                    className={`w-5 h-5 mb-6 transition-colors ${
                      active === i ? "text-[#b0568f]" : "text-muted-foreground/50"
                    }`}
                  />
                  <h3 className="text-xl font-display mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className={`mt-16 pt-8 border-t border-foreground/10 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground transition-all duration-1000 delay-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#b0568f]" />
            Dedicated security page and responsible disclosure at /security
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px]">
            <ShieldCheck className="w-4 h-4 text-[#b0568f]" />
            status page · live checks
          </span>
        </div>
      </div>
    </section>
  );
}
