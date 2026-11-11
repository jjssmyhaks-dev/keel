"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    number: "01",
    title: "Register",
    subtitle: "the agent",
    description:
      "Create an agent in the dashboard, CLI or SDK. Authab issues a key pair, stores the public half, and returns the private key exactly once.",
    fileName: "register.ts",
    code: `import { Authab } from "@authab/sdk";

const authab = new Authab({ apiKey: process.env.AUTHAB_KEY });
const atlas = await authab.agents.create({
  name: "atlas",
  owner: "maya@northwind.dev",
  tags: ["research", "support"],
});

await atlas.saveIdentity("./.authab/atlas.json");`,
  },
  {
    number: "02",
    title: "Grant",
    subtitle: "least privilege",
    description:
      "Attach a credential, then scope the agent to specific actions and resources. Read is instant. Writes can require a human, a window, or a spend cap.",
    fileName: "grants.ts",
    code: `await authab.grants.create({
  agentId: atlas.id,
  credentialId: slack.id,
  actions: ["slack.post_message", "slack.list_channels"],
  resourcePattern: "channel:#support-*",
  approvalMode: "auto",
  conditions: { hours: "09:00-19:00 IST" },
});`,
  },
  {
    number: "03",
    title: "Execute",
    subtitle: "through the vault",
    description:
      "The agent exchanges its identity for a 5-minute token, then calls the proxy. Policy runs. The credential is injected server-side. A hash-chained event is written.",
    fileName: "execute.ts",
    code: `const token = await authab.auth.token(atlas.identity);

const result = await authab.proxy.call({
  token,
  connector: "slack",
  action: "slack.post_message",
  input: { channel: "#support-eu", text: summary },
});

// credential never entered this process`,
  },
];

export function ProcessSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), {
      threshold: 0.1,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => setActiveStep((v) => (v + 1) % steps.length), 6500);
    return () => clearInterval(interval);
  }, [paused]);

  const step = steps[activeStep];

  return (
    <section
      id="process"
      ref={ref}
      className="relative py-24 lg:py-32 bg-[oklch(0.09_0.01_260)] text-white overflow-hidden"
    >
      <div className="absolute bottom-0 left-0 w-[420px] h-[420px] rounded-full bg-white/[0.02] blur-[110px] pointer-events-none" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="relative mb-16 lg:mb-24 grid lg:grid-cols-2 gap-8 lg:gap-12 items-end">
          <div>
            <div className={`transition-all duration-1000 ${visible ? "opacity-100" : "opacity-0"}`}>
              <span className="inline-flex items-center gap-3 text-sm font-mono text-white/40 mb-8">
                <span className="w-12 h-px bg-white/20" />
                Process
              </span>
            </div>
            <h2
              className={`text-6xl md:text-7xl lg:text-[112px] font-display tracking-tight leading-[0.88] transition-all duration-1000 delay-100 ${
                visible ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
              }`}
            >
              <span className="block">Register.</span>
              <span className="block text-white/30">Grant.</span>
              <span className="block text-white/10">Execute.</span>
            </h2>
          </div>

          <div className="lg:pb-6">
            <p className="text-lg lg:text-xl text-white/50 leading-relaxed max-w-md">
              Three calls to go from a bare model to an agent with a real identity and a
              governed path to production.
            </p>
            <div className="mt-8 inline-flex items-center gap-3 font-mono text-[11px] text-white/35">
              <span className="w-1.5 h-1.5 rounded-full bg-[#eca8d6] live-dot" />
              Dev mode is permissive. Prod enforces.
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 mb-8">
          {steps.map((item, index) => (
            <button
              key={item.number}
              type="button"
              onMouseEnter={() => {
                setActiveStep(index);
                setPaused(true);
              }}
              onMouseLeave={() => setPaused(false)}
              onClick={() => setActiveStep(index)}
              className={`relative text-left p-8 lg:p-10 border transition-all duration-500 ${
                activeStep === index
                  ? "bg-black border-white/60"
                  : "bg-black border-white/15 hover:border-white/40"
              }`}
            >
              <div className="flex items-center gap-4 mb-8">
                <span
                  className={`text-4xl font-display transition-colors duration-300 ${
                    activeStep === index ? "text-[#eca8d6]" : "text-white/20"
                  }`}
                >
                  {item.number}
                </span>
                <div className="flex-1 h-px bg-white/10 overflow-hidden">
                  {activeStep === index && <div className="h-full bg-[#eca8d6]/50 animate-progress" />}
                </div>
              </div>
              <h3 className="text-3xl lg:text-4xl font-display mb-1">{item.title}</h3>
              <span className="text-xl text-white/40 font-display block mb-5">{item.subtitle}</span>
              <p className="text-sm text-white/55 leading-relaxed">{item.description}</p>
              <div
                className={`absolute bottom-0 left-0 right-0 h-px bg-[#eca8d6] transition-transform duration-500 origin-left ${
                  activeStep === index ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          ))}
        </div>

        <div className={`border border-white/10 bg-black transition-all duration-700 ${visible ? "opacity-100" : "opacity-0"}`}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="ml-3 font-mono text-[11px] text-white/40">{step.fileName}</span>
            </div>
            <span className="font-mono text-[10px] text-white/25 uppercase tracking-widest">typescript</span>
          </div>
          <pre className="p-6 lg:p-8 overflow-x-auto text-[13px] leading-[1.85] text-white/75 font-mono min-h-[280px]">
            <code>{step.code}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
