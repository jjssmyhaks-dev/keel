"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import Link from "next/link";

type Effect = "allow" | "approve" | "deny";

const agents = [
  {
    id: "atlas",
    name: "atlas",
    role: "Research & support",
    grants: {
      "slack.list_channels": "allow",
      "slack.post_message": "allow",
      "github.create_issue": "allow",
      "stripe.create_refund": "none",
    },
  },
  {
    id: "scout",
    name: "scout",
    role: "Data ingestion",
    grants: {
      "slack.list_channels": "allow",
      "slack.post_message": "none",
      "github.create_issue": "none",
      "stripe.create_refund": "none",
    },
  },
  {
    id: "ledger",
    name: "ledger",
    role: "Finance ops",
    grants: {
      "slack.list_channels": "allow",
      "slack.post_message": "allow",
      "github.create_issue": "none",
      "stripe.create_refund": "approve",
    },
  },
] as const;

const actions = [
  { id: "slack.list_channels", label: "slack.list_channels", risk: "read", target: "#support-eu" },
  { id: "slack.post_message", label: "slack.post_message", risk: "write", target: "#support-eu" },
  { id: "github.create_issue", label: "github.create_issue", risk: "write", target: "northwind/atlas" },
  { id: "stripe.create_refund", label: "stripe.create_refund", risk: "financial", target: "ch_3Qx9…" },
] as const;

const riskColor: Record<string, string> = {
  read: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  write: "text-amber-300 border-amber-300/30 bg-amber-300/10",
  financial: "text-[#eca8d6] border-[#eca8d6]/30 bg-[#eca8d6]/10",
};

export function PolicyDemo() {
  const [agentId, setAgentId] = useState<(typeof agents)[number]["id"]>("atlas");
  const [actionId, setActionId] = useState<(typeof actions)[number]["id"]>("slack.post_message");
  const [env, setEnv] = useState<"development" | "production">("development");
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      threshold: 0.1,
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const agent = agents.find((a) => a.id === agentId)!;
  const action = actions.find((a) => a.id === actionId)!;

  const decision: Effect = useMemo(() => {
    const grant = agent.grants[action.id as keyof typeof agent.grants];
    if (grant === "none") return "deny";
    if (grant === "approve") return env === "development" ? "allow" : "approve";
    if (action.risk === "read") return "allow";
    if (env === "production") return "approve";
    return "allow";
  }, [agent, action, env]);

  const checks = useMemo(
    () => [
      { label: "Agent identity verified", detail: "EdDSA signature valid · token exp 4m 52s", ok: true },
      {
        label: "Grant matched",
        detail:
          agent.grants[action.id as keyof typeof agent.grants] === "none"
            ? `no grant for ${action.id}`
            : `grant_${agent.id}_${action.id.split(".")[0]} · ${action.risk}`,
        ok: agent.grants[action.id as keyof typeof agent.grants] !== "none",
      },
      {
        label: "Resource in scope",
        detail: action.target,
        ok: agent.grants[action.id as keyof typeof agent.grants] !== "none",
      },
      {
        label: "Approval policy",
        detail:
          decision === "approve"
            ? env === "production"
              ? "production write → human required"
              : "dev mode auto-approves writes"
            : decision === "deny"
              ? "request blocked before execution"
              : "auto-allow",
        ok: decision !== "deny",
      },
      { label: "Audit event queued", detail: "hash-chained · evt_01JQ…", ok: decision !== "deny" },
    ],
    [agent, action, decision, env]
  );

  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRunning(true);
    setStage(-1);
    checks.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStage(i), 320 * (i + 1)));
    });
    timers.current.push(setTimeout(() => setRunning(false), 320 * checks.length + 450));
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(-1);
    setRunning(false);
  };

  const decisionLabel =
    decision === "allow" ? "Allowed" : decision === "approve" ? "Awaiting approval" : "Denied";
  const decisionColor =
    decision === "allow"
      ? "text-emerald-400"
      : decision === "approve"
        ? "text-amber-300"
        : "text-red-400";

  return (
    <section id="policy" ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <div className="lg:col-span-4 lg:sticky lg:top-32">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
              <span className="w-12 h-px bg-foreground/30" />
              Policy engine
            </span>
            <h2
              className={`text-5xl md:text-6xl lg:text-7xl font-display tracking-tight leading-[0.92] transition-all duration-1000 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              Every call
              <br />
              <span className="text-muted-foreground">gets a verdict.</span>
            </h2>
            <p className="mt-8 text-lg text-muted-foreground leading-relaxed">
              The same engine runs in dev and prod. Development forgives, production
              enforces. Try a request and watch the checks run in order.
            </p>
            <div className="mt-10 space-y-3 font-mono text-[11px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> allow
              </div>
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> requires human approval
              </div>
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> denied · never executed
              </div>
            </div>
            <Link
              href="/docs/concepts/policy"
              className="mt-10 inline-flex items-center gap-2 text-sm underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground transition-colors"
            >
              Read how policy resolves
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div
            className={`lg:col-span-8 border border-foreground/10 bg-foreground/[0.02] transition-all duration-1000 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-5 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-[#eca8d6] live-dot" />
                sandbox · policy inspector
              </div>
              <div className="flex items-center border border-foreground/10 font-mono text-[10px]">
                {(["development", "production"] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      setEnv(e);
                      reset();
                    }}
                    className={`px-3 py-1.5 uppercase tracking-widest transition-colors ${
                      env === e ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 lg:p-7 grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="mono-label text-muted-foreground/70 block mb-2">Agent</span>
                <select
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value as typeof agentId);
                    reset();
                  }}
                  className="w-full bg-background border border-foreground/15 px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground/50"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mono-label text-muted-foreground/70 block mb-2">Action</span>
                <select
                  value={actionId}
                  onChange={(e) => {
                    setActionId(e.target.value as typeof actionId);
                    reset();
                  }}
                  className="w-full bg-background border border-foreground/15 px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground/50"
                >
                  {actions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} [{a.risk}]
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mx-5 lg:mx-7 mb-5 border border-foreground/10 bg-background font-mono text-[11px]">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground/10 text-muted-foreground">
                <span>POST /v1/proxy/slack</span>
                <span className={`px-2 py-0.5 border ${riskColor[action.risk]}`}>{action.risk}</span>
              </div>
              <pre className="px-4 py-3.5 overflow-x-auto text-foreground/75 leading-relaxed">{`{
  "agent": "${agent.name}",
  "action": "${action.id}",
  "resource": "${action.target}",
  "environment": "${env}"
}`}</pre>
            </div>

            <div className="mx-5 lg:mx-7 mb-5 space-y-0 border border-foreground/10">
              {checks.map((check, i) => {
                const shown = stage >= i;
                return (
                  <div
                    key={check.label}
                    className={`flex items-start justify-between gap-4 px-4 py-3 border-b last:border-b-0 border-foreground/10 transition-all duration-300 ${
                      shown ? "opacity-100" : "opacity-30"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          !shown
                            ? "bg-foreground/20"
                            : check.ok
                              ? "bg-emerald-500"
                              : "bg-red-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm">{check.label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {shown ? check.detail : "waiting"}
                        </div>
                      </div>
                    </div>
                    <span className="mono-label text-[9px] text-muted-foreground shrink-0 pt-1">
                      {shown ? (check.ok ? "pass" : "fail") : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mx-5 lg:mx-7 mb-6 flex flex-wrap items-center justify-between gap-4 border border-foreground/10 px-4 py-3.5 bg-foreground/[0.02]">
              <div>
                <div className="mono-label text-muted-foreground/70 mb-1">Decision</div>
                <div className={`text-xl font-display ${stage >= 3 ? decisionColor : "text-muted-foreground/40"}`}>
                  {stage >= 3 ? decisionLabel : "—"}
                </div>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground text-right leading-relaxed">
                <div>{env === "production" ? "prod · strict" : "dev · relaxed"}</div>
                <div>{decision === "deny" ? "never executed" : "credential injected server-side"}</div>
              </div>
            </div>

            <div className="px-5 lg:px-7 pb-7 flex items-center gap-3">
              <button
                onClick={run}
                disabled={running}
                className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                {running ? "Evaluating…" : "Run request"}
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 border border-foreground/15 px-5 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
