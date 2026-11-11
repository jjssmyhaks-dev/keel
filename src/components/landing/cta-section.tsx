"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CtaSection({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [mouse, setMouse] = useState({ x: 50, y: 50 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.2,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div
          className={`relative border border-foreground transition-all duration-1000 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMouse({
              x: ((e.clientX - rect.left) / rect.width) * 100,
              y: ((e.clientY - rect.top) / rect.height) * 100,
            });
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none transition-opacity duration-300"
            style={{
              background: `radial-gradient(560px circle at ${mouse.x}% ${mouse.y}%, rgba(236,168,214,0.7), transparent 45%)`,
            }}
          />
          <div className="absolute inset-0 grain pointer-events-none" />

          <div className="relative z-10 px-8 lg:px-16 py-16 lg:py-24 grid lg:grid-cols-12 gap-12 items-end">
            <div className="lg:col-span-8">
              <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-8">
                <span className="w-8 h-px bg-foreground/30" />
                Start in development
              </span>
              <h2 className="text-5xl md:text-6xl lg:text-[88px] font-display tracking-tight mb-8 leading-[0.92]">
                Give your agents
                <br />
                a spine.
              </h2>
              <p className="text-lg lg:text-xl text-muted-foreground mb-10 leading-relaxed max-w-xl">
                Register your first agent, connect one service and make a governed call.
                Free forever in development. No credit card.
              </p>
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Link
                  href="/sign-up"
                  className="group inline-flex items-center gap-2 bg-foreground text-background px-8 h-14 text-sm font-medium rounded-full hover:bg-foreground/90 transition-colors"
                >
                  Start building free
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/docs/quickstart"
                  className="inline-flex items-center h-14 px-8 text-sm rounded-full border border-foreground/20 hover:bg-foreground/5 transition-colors"
                >
                  Read the quickstart
                </Link>
              </div>
              {demoEnabled ? (
                <p className="text-[11px] text-muted-foreground mt-8 font-mono">
                  Or sign in with the demo workspace → demo@authab.dev
                </p>
              ) : null}
            </div>

            <div className="lg:col-span-4 font-mono text-[10px] leading-[1.9] text-muted-foreground border-l border-foreground/10 pl-6 hidden lg:block">
              <div className="text-foreground/60 mb-2">// first call, abridged</div>
              <div><span className="text-[#b0568f]">const</span> atlas = await authab.agents.create({`{`}</div>
              <div className="pl-4">name: <span className="text-foreground/70">&quot;atlas&quot;</span>,</div>
              <div>{`})`};</div>
              <div className="mt-2"><span className="text-[#b0568f]">await</span> authab.proxy.call({`{`}</div>
              <div className="pl-4">token, connector: <span className="text-foreground/70">&quot;slack&quot;</span>,</div>
              <div className="pl-4">action: <span className="text-foreground/70">&quot;slack.post_message&quot;</span>,</div>
              <div>{`})`};</div>
              <div className="mt-3 text-emerald-600 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                allowed · audit evt_01JQ8…
              </div>
            </div>
          </div>

          <div className="absolute top-0 right-0 w-24 h-24 border-b border-l border-foreground/10" />
          <div className="absolute bottom-0 left-0 w-24 h-24 border-t border-r border-foreground/10" />
        </div>
      </div>
    </section>
  );
}
