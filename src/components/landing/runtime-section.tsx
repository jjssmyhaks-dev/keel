"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";

const components = [
  { name: "Connector registry", detail: "Versioned manifests, scopes, allowed hosts" },
  { name: "Policy hook", detail: "Grants, risk levels, approval routing" },
  { name: "Action executor", detail: "Schema validation, credential injection" },
  { name: "Response normalizer", detail: "Error mapping, field redaction" },
  { name: "Rate limiter", detail: "Per-agent limits, enforced in Postgres" },
  { name: "Health monitor", detail: "Token validity, scope drift, broken links" },
];

const guarantees = [
  { k: "allow-list", v: "Only hosts declared in the connector manifest" },
  { k: "injection", v: "Secrets decrypted in memory, only for the executor" },
  { k: "redaction", v: "Configured fields never reach logs" },
  { k: "timeouts", v: "15-second upstream limit; failures are surfaced, never swallowed" },
];

function FlowDiagram() {
  return (
    <div className="relative border border-white/10 bg-black p-6 lg:p-10">
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative font-mono text-[10px] text-white/30 mb-10 flex items-center justify-between">
        <span>POST /v1/proxy/slack/slack.post_message</span>
        <span className="hidden sm:inline">x-request-id: req_01JQ8…</span>
      </div>

      <div className="relative flex flex-col gap-0">
        <div className="border border-white/15 bg-black px-5 py-4 flex items-center justify-between">
          <div>
            <div className="mono-label text-white/35 mb-1">Caller</div>
            <div className="text-white text-sm">Agent · atlas</div>
          </div>
          <div className="font-mono text-[10px] text-white/35 text-right">
            <div>Bearer eyJhbGciOiJFZERTQS…</div>
            <div className="text-[#eca8d6]/70">exp 4m 52s</div>
          </div>
        </div>

        <div className="flex justify-center py-2 text-white/25">
          <ArrowDown className="w-4 h-4" />
        </div>

        <div className="border border-[#eca8d6]/40 bg-[#eca8d6]/[0.04] px-5 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-white text-sm">Keel proxy</div>
            <div className="mono-label text-[#eca8d6] text-[9px]">policy · vault · audit</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {["verify token", "match grant", "inject secret"].map((label, i) => (
              <div key={label} className="border border-white/10 px-2 py-2.5 text-[10px] text-white/55">
                <span className="text-[#eca8d6]/70 mr-1">{String(i + 1).padStart(2, "0")}</span>
                {label}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px]">
            <span className="text-white/30">host allow-list: slack.com</span>
            <span className="text-emerald-400">credential ready</span>
          </div>
        </div>

        <div className="flex justify-center py-2 text-white/25">
          <ArrowDown className="w-4 h-4" />
        </div>

        <div className="border border-white/15 bg-black px-5 py-4 flex items-center justify-between">
          <div>
            <div className="mono-label text-white/35 mb-1">Upstream</div>
            <div className="text-white text-sm">api.slack.com</div>
          </div>
          <div className="font-mono text-[10px] text-white/35 text-right">
            <div>200 OK · 214 ms</div>
            <div>ratelimit-remaining: 47</div>
          </div>
        </div>
      </div>

      <div className="relative mt-8 grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/10 border border-white/10">
        {guarantees.map((g) => (
          <div key={g.k} className="bg-black p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#eca8d6]/70 mb-1">{g.k}</div>
            <div className="text-[10px] text-white/45 leading-snug">{g.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RuntimeSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.1,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="runtime"
      ref={ref}
      className="relative py-24 lg:py-32 bg-[oklch(0.09_0.01_260)] text-white overflow-hidden"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-32">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-white/40 mb-6">
              <span className="w-12 h-px bg-white/20" />
              Runtime
            </span>
            <h2
              className={`text-6xl md:text-7xl font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              The secret
              <br />
              <span className="text-white/30">stays here.</span>
            </h2>
            <p className="mt-8 text-lg text-white/50 leading-relaxed max-w-md">
              Agents call named actions. The proxy checks the grant, evaluates policy,
              decrypts the credential inside the executor, calls an allowed host only,
              then writes a redacted audit event.
            </p>
            <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
              {components.map((c, i) => (
                <div key={c.name} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="flex items-start gap-4">
                    <span className="font-mono text-[10px] text-white/25 mt-1">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-sm text-white/85">{c.name}</div>
                      <div className="text-[11px] text-white/35 mt-0.5">{c.detail}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className={`lg:col-span-7 transition-all duration-1000 delay-200 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
            }`}
          >
            <FlowDiagram />
            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[10px] text-white/30">
              <span>response normalization</span>
              <span>idempotency keys</span>
              <span>15s upstream timeout</span>
              <span className="text-[#eca8d6]/70">raw key reveal: off by default</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
