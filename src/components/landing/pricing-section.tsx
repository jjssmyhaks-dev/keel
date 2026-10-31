"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Zap } from "lucide-react";
import { PLANS, planFor } from "@/lib/plans";

function priceFor(key: string, currency: "USD" | "INR", annual: boolean) {
  const plan = planFor(key);
  const base = currency === "INR" ? plan.priceInr : plan.priceUsd;
  if (base === null) return { display: "Custom", note: "talk to us" };
  if (base === 0) return { display: currency === "INR" ? "₹0" : "$0", note: "free forever" };
  const monthly = annual ? Math.round(base * 0.8) : base;
  return {
    display: currency === "INR" ? `₹${monthly.toLocaleString("en-IN")}` : `$${monthly}`,
    note: annual ? "billed annually" : "billed monthly",
  };
}

export function PricingSection({ standalone = false }: { standalone?: boolean }) {
  const [currency, setCurrency] = useState<"USD" | "INR">("USD");
  const [annual, setAnnual] = useState(true);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.05,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="pricing"
      ref={ref}
      className={`relative overflow-hidden ${standalone ? "pt-32 pb-24 lg:pt-40" : "py-24 lg:py-32"}`}
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-8 mb-16">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-8">
              <span className="w-12 h-px bg-foreground/30" />
              Pricing
            </span>
            <h2
              className={`text-6xl md:text-7xl lg:text-[112px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              Pay for
              <br />
              <span className="text-stroke">agents.</span>
            </h2>
          </div>
          <div className="lg:col-span-5 flex flex-col justify-end gap-6">
            <p className="text-lg text-muted-foreground leading-relaxed max-w-sm">
              Production mode starts on Pro. Every plan meters the same four things:
              active agents, proxy calls, stored connections and audit retention.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex border border-foreground/15 font-mono text-[10px]">
                {(["USD", "INR"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrency(c)}
                    className={`px-4 py-2 transition-colors ${
                      currency === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c === "USD" ? "$ USD" : "₹ INR"}
                  </button>
                ))}
              </div>
              <div className="inline-flex border border-foreground/15 font-mono text-[10px]">
                <button
                  onClick={() => setAnnual(false)}
                  className={`px-4 py-2 transition-colors ${
                    !annual ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setAnnual(true)}
                  className={`px-4 py-2 transition-colors ${
                    annual ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Annual −20%
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan, index) => {
            const price = priceFor(plan.key, currency, annual);
            return (
              <div
                key={plan.key}
                className={`relative flex flex-col border bg-background transition-all duration-700 ${
                  plan.highlight ? "border-foreground lg:-my-2" : "border-foreground/10"
                } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-6 right-6 flex justify-center">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background text-[9px] font-mono uppercase tracking-widest">
                      <Zap className="w-3 h-3" />
                      Most popular
                    </span>
                  </div>
                )}
                <div className="p-7 lg:p-8 flex-1">
                  <div className="mb-7 pb-7 border-b border-foreground/10">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-2xl font-display mt-1.5">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed min-h-[48px]">
                      {plan.description}
                    </p>
                  </div>
                  <div className="mb-7">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-4xl lg:text-5xl font-display tracking-tight">{price.display}</span>
                      {plan.priceUsd !== null && plan.priceUsd > 0 && (
                        <span className="text-xs text-muted-foreground">/mo</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 font-mono">{price.note}</p>
                  </div>
                  <ul className="space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check className="w-3.5 h-3.5 text-[#b0568f] mt-0.5 shrink-0" />
                        <span className="text-[13px] text-muted-foreground leading-snug">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-7 lg:p-8 pt-0">
                  <Link
                    href={plan.key === "enterprise" ? "/contact" : `/sign-up?plan=${plan.key}`}
                    className={`w-full py-3.5 flex items-center justify-center gap-2 text-sm font-medium transition-all group ${
                      plan.highlight
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-foreground/20 hover:border-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {plan.cta}
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={`mt-14 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 pt-10 border-t border-foreground/10 transition-all duration-1000 delay-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-[#b0568f]" />
              Overage billed per 10k calls
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-[#b0568f]" />
              USD and INR billing
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-[#b0568f]" />
              GST invoices
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-[#b0568f]" />
              Cancel anytime
            </span>
          </div>
          <Link href="/pricing" className="text-sm underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground transition-colors">
            Compare every limit
          </Link>
        </div>
      </div>
    </section>
  );
}
