"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

const languages = ["TypeScript", "cURL"] as const;

const snippets: Record<(typeof languages)[number], string> = {
  TypeScript: `import { Keel } from "@keel/sdk";

const keel = new Keel({ apiKey: process.env.KEEL_SECRET_KEY });

// 1. register an agent (identity is generated locally)
const agent = await keel.agents.create({ name: "atlas" });

// 2. grant it a connector, scoped to one channel
await keel.grants.create({
  agentId: agent.id,
  credentialId: "cred_slack",
  actions: ["slack.post_message"],
  resourcePattern: "channel:#support-eu",
  approvalMode: "auto",
});

// 3. act. the credential never enters this process.
const token = await keel.auth.token(agent.identity);
await keel.proxy.call({
  token,
  connector: "slack",
  action: "slack.post_message",
  input: { channel: "#support-eu", text: "Daily digest ready." },
});`,
  cURL: `# exchange the agent identity for a 5-minute token
curl -X POST https://api.keel.dev/v1/agents/atlas/token \\
  -H "Authorization: Bearer $KEEL_SECRET_KEY" \\
  -d '{"challenge":"$(date +%s)","signature":"…"}'

# call an action through the proxy
curl -X POST https://api.keel.dev/v1/proxy/slack \\
  -H "Authorization: Bearer $AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "slack.post_message",
    "input": { "channel": "#support-eu", "text": "Daily digest ready." }
  }'`,
};

const features = [
  { title: "TypeScript SDK", description: "A first-party client with typed actions and errors." },
  { title: "CLI included", description: "Register, rotate, tail logs and promote from CI." },
  { title: "MCP native", description: "Connector catalogs become MCP tools automatically." },
  { title: "Framework ready", description: "LangGraph, CrewAI, OpenAI Agents, Vercel AI SDK." },
];

export function DevelopersSection() {
  const [lang, setLang] = useState<(typeof languages)[number]>("TypeScript");
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.1,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippets[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <section id="developers" ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-32">
            <span className={`inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6 transition-all duration-700 ${visible ? "opacity-100" : "opacity-0"}`}>
              <span className="w-10 h-px bg-foreground/30" />
              Developer SDK
            </span>
            <h2
              className={`text-6xl md:text-7xl lg:text-8xl font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              Boring
              <br />
              <span className="text-muted-foreground">by design.</span>
            </h2>
            <p className="mt-8 text-lg text-muted-foreground leading-relaxed max-w-md">
              A small, typed surface area. No new runtime, no sidecar, no proxy SDK to
              deploy. If your agent can make an HTTP request, it can use Keel.
            </p>
            <div className="mt-10 grid grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <div
                  key={feature.title}
                  className={`transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
                  style={{ transitionDelay: `${index * 50 + 200}ms` }}
                >
                  <h3 className="font-medium mb-1 text-sm">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 border border-foreground/10 p-4 font-mono text-[11px] text-muted-foreground flex items-center gap-3">
              <span className="text-[#b0568f]">$</span>
              npx @keel/cli init
            </div>
          </div>

          <div
            className={`lg:col-span-7 border border-foreground/10 bg-[oklch(0.09_0.01_260)] text-white overflow-hidden transition-all duration-1000 delay-150 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4">
              <div className="flex">
                {languages.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`px-4 py-3.5 font-mono text-[11px] transition-colors border-b-2 -mb-px ${
                      lang === l
                        ? "text-white border-[#eca8d6]"
                        : "text-white/40 border-transparent hover:text-white/70"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                onClick={copy}
                className="inline-flex items-center gap-2 font-mono text-[10px] text-white/40 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#eca8d6]" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <pre className="p-6 lg:p-8 overflow-x-auto text-[12.5px] leading-[1.85] text-white/75 font-mono min-h-[540px]">
              <code>{snippets[lang]}</code>
            </pre>
            <div className="border-t border-white/10 px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] text-white/30">
              <span>npm i @keel/sdk</span>
              <span>openapi 3.1</span>
              <span className="text-[#eca8d6]/70">typed errors · retries</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
