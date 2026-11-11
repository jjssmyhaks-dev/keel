"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CONNECTORS } from "@/lib/connectors";
import { ConnectorLogo } from "@/components/connector-logo";

const totalActions = CONNECTORS.reduce((sum, c) => sum + c.actions.length, 0);

const modes = [
  {
    tag: "Default",
    title: "Named action",
    body: "The agent calls an action from the catalog with structured input. Every call carries a known risk level and validated schema.",
    code: "authab.actions.call(\"slack.post_message\", { … })",
  },
  {
    tag: "Escape hatch",
    title: "Raw proxied request",
    body: "For endpoints that aren't in the catalog yet. The proxy injects the credential but only to hosts the manifest allows.",
    code: "authab.proxy.post(\"/chat.postMessage\", { … })",
  },
  {
    tag: "Zero code",
    title: "MCP tools",
    body: "Each connector's action catalog is exposed as MCP tools, so MCP-native agents get governed access without a custom SDK.",
    code: "tools: [\"slack_post_message\", …]",
  },
];

const slugs = CONNECTORS.map((c) => c.slug);
const categories = ["All", ...Array.from(new Set(CONNECTORS.map((c) => c.category)))];

export function ConnectorsSection() {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [category, setCategory] = useState("All");
  const ref = useRef<HTMLElement>(null);
  const shown = category === "All" ? CONNECTORS : CONNECTORS.filter((c) => c.category === category);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.05,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="connectors" ref={ref} className="relative overflow-hidden">
      <div className="relative z-10 pt-24 lg:pt-32 text-center">
        <span
          className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 justify-center transition-all duration-700 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="w-12 h-px bg-foreground/20" />
          Connectors
          <span className="w-12 h-px bg-foreground/20" />
        </span>
        <h2
          className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Connect
          <br />
          <span className="text-muted-foreground">the stack.</span>
        </h2>
        <p
          className={`mt-8 text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-lg mx-auto px-6 transition-all duration-1000 delay-100 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          Each connector is a declarative manifest: auth method, allowed hosts, action
          catalog, risk levels, redaction rules. Adding a service is a file, not a fork.
        </p>
      </div>

      <div className={`mt-14 overflow-hidden border-y border-foreground/10 py-4 transition-opacity duration-1000 delay-200 ${visible ? "opacity-100" : "opacity-0"}`}>
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap">
          {[...Array(2)].map((_, dup) => (
            <div key={dup} className="flex gap-10" aria-hidden={dup === 1}>
              {[...slugs, ...slugs].map((slug, index) => (
                <span key={`${dup}-${index}-${slug}`} className="font-mono text-[11px] text-muted-foreground/50 flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-[#eca8d6]/60" />
                  {slug}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12 mt-14">
        <div className={`flex flex-wrap items-center gap-2 mb-6 transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`}>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setCategory(item);
                setHovered(null);
              }}
              className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                category === item
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {item}
              <span className={`ml-2 ${category === item ? "text-background/60" : "text-muted-foreground/60"}`}>
                {item === "All" ? CONNECTORS.length : CONNECTORS.filter((c) => c.category === item).length}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {shown.map((c, index) => (
            <Link
              key={c.slug}
              href={`/docs/connectors/${c.slug}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              className={`group relative overflow-hidden border p-6 lg:p-7 transition-all duration-500 ${
                hovered === index
                  ? "border-foreground bg-foreground/[0.04] scale-[1.02]"
                  : "border-foreground/10 hover:border-foreground/30"
              } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
              style={{ transitionDelay: `${index * 30 + 250}ms` }}
            >
              <span
                className={`absolute top-3 right-3 text-[10px] font-mono px-2 py-0.5 transition-colors ${
                  hovered === index ? "bg-foreground text-background" : "bg-foreground/10 text-muted-foreground"
                }`}
              >
                {c.category}
              </span>
              <div className="w-10 h-10 mb-10 flex items-center justify-center border border-foreground/15">
                <ConnectorLogo slug={c.slug} mark={c.mark} className="w-5 h-5" />
              </div>
              <span className="font-medium block text-[15px]">{c.name}</span>
              <span className="text-[11px] font-mono text-muted-foreground mt-1 block">
                {c.actions.length} actions · {c.version}
              </span>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-foreground/20 overflow-hidden">
                <div
                  className={`h-full bg-foreground transition-all duration-500 ${
                    hovered === index ? "w-full" : "w-0"
                  }`}
                />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-16 grid lg:grid-cols-3 gap-4">
          {modes.map((mode, i) => (
            <div
              key={mode.title}
              className={`border border-foreground/10 p-7 lg:p-8 transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${i * 90 + 400}ms` }}
            >
              <div className="mono-label text-[#b0568f] mb-5">{mode.tag}</div>
              <h3 className="text-2xl font-display mb-3">{mode.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">{mode.body}</p>
              <code className="block border border-foreground/10 bg-foreground/[0.03] px-3 py-2.5 text-[11px] font-mono text-muted-foreground truncate">
                {mode.code}
              </code>
            </div>
          ))}
        </div>

        <div
          className={`mt-14 flex flex-wrap items-center justify-between gap-8 pt-10 border-t border-foreground/10 pb-24 lg:pb-32 transition-all duration-1000 delay-500 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex flex-wrap gap-12">
            {[
              { value: String(CONNECTORS.length), label: "connectors in the catalog" },
              { value: String(totalActions), label: "governed actions" },
              { value: "5", label: "risk levels enforced" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-3">
                <span className="text-3xl font-display">{stat.value}</span>
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
            ))}
          </div>
          <Link
            href="/docs/connectors"
            className="group inline-flex items-center gap-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Browse the catalog
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
}
