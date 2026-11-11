"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { RiskBadge, StatusBadge } from "@/components/app/ui";
import { SANDBOX_SAMPLE_APPS } from "@/lib/sandbox-samples";
import { runSandboxAction, type PlaygroundRunState } from "./actions";

type AgentOption = {
  id: string;
  name: string;
  status: string;
  keyMode: string;
  hasGrant: boolean;
};

type ActionOption = {
  name: string;
  label: string;
  risk: string;
  description: string;
  fields: { key: string; label: string; placeholder: string; required: boolean }[];
};

const DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
  "sandbox.echo": { message: "Summarize the last five tickets" },
  "sandbox.create_ticket": { subject: "Checkout latency spike", priority: "high" },
  "sandbox.charge_card": { amount: 4200, currency: "usd", customer: "cus_sandbox_1" },
  "sandbox.delete_workspace": { workspace: "demo-staging" },
  "sandbox.grant_role": { user: "contractor@example.com", role: "admin" },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function PlaygroundClient({
  agents,
  actions,
  canRun,
  hasConnection,
  environmentType,
}: {
  agents: AgentOption[];
  actions: ActionOption[];
  canRun: boolean;
  hasConnection: boolean;
  environmentType: string;
}) {
  const [state, formAction, pending] = useActionState<PlaygroundRunState | null, FormData>(
    runSandboxAction,
    null,
  );
  const firstActive = agents.find((agent) => agent.status === "active") ?? agents[0];
  const router = useRouter();
  const [agentId, setAgentId] = useState(firstActive?.id ?? "");
  const [actionName, setActionName] = useState(actions[0]?.name ?? "");
  const [resource, setResource] = useState("demo/checkout");
  const [input, setInput] = useState(() =>
    JSON.stringify(DEFAULT_INPUTS[actions[0]?.name ?? ""] ?? {}, null, 2),
  );

  useEffect(() => {
    if (state) router.refresh();
  }, [state, router]);

  const agent = agents.find((entry) => entry.id === agentId);
  const action = actions.find((entry) => entry.name === actionName);
  const agentReady = agent?.status === "active" && agent?.keyMode !== "client";
  const needsGrant = agent ? !agent.hasGrant : false;

  const snippet = useMemo(() => {
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(input || "{}");
    } catch {
      parsedInput = "[invalid JSON]";
    }
    const body = JSON.stringify(
      { action: actionName, ...(resource.trim() ? { resource: resource.trim() } : {}), input: parsedInput },
      null,
      2,
    );
    return `curl -X POST "$AUTHAB_URL/api/v1/proxy/sandbox" \\
  -H "Authorization: Bearer $AUTHAB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${body.replace(/'/g, "'\\''")}'`;
  }, [actionName, resource, input]);

  const payload = asRecord(state?.payload);
  const error = asRecord(payload?.error);
  const errorDetails = asRecord(error?.details);
  const decision = asRecord(payload?.decision) ?? asRecord(errorDetails?.decision);
  const result = asRecord(payload?.result);
  const approval = asRecord(payload?.approval);
  const responseStatus = text(payload?.status);
  const errorCode = text(error?.code);
  const errorMessage = text(error?.message);
  const approvalId = text(approval?.id);
  const decisionReason = text(decision?.reason);
  const decisionSource = text(decision?.source);
  const decisionRisk = text(decision?.risk);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
      <div className="min-w-0 space-y-6">
        <section className="border border-black/10 bg-white dark:border-border dark:bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-border">
            <div>
              <h2 className="text-[13px] font-medium">Run a call</h2>
              <p className="mt-0.5 text-[11px] text-black/60 dark:text-muted-foreground">
                A 60-second agent token is issued for this run, then discarded.
              </p>
            </div>
            {action ? <RiskBadge risk={action.risk} /> : null}
          </header>

          <form
            onSubmit={(event) => {
              // React 19 resets forms after a server action, which desyncs the
              // controlled selects; dispatch the action explicitly instead.
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(() => formAction(formData));
            }}
            className="p-4 sm:p-5"
          >
            <fieldset disabled={!canRun || pending} className="space-y-4">
              {!canRun ? (
                <p className="border border-black/45 bg-[#faf9f6] px-3 py-2 text-[12px] leading-relaxed text-black/60 dark:border-white/40 dark:bg-background dark:text-muted-foreground">
                  Your role can view the playground but cannot issue agent tokens or create grants. Ask an owner,
                  admin or developer in this environment.
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Agent
                  </span>
                  <select
                    name="agentId"
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                    className="mt-1 block w-full border border-black/45 bg-white px-2 py-2 text-[12px] dark:border-white/40 dark:bg-background"
                  >
                    {agents.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                        {entry.status !== "active" ? ` · ${entry.status}` : ""}
                        {entry.keyMode === "client" ? " · client key" : ""}
                        {entry.hasGrant ? "" : " · no sandbox grant"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                    Action
                  </span>
                  <select
                    name="action"
                    value={actionName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setActionName(next);
                      setInput(JSON.stringify(DEFAULT_INPUTS[next] ?? {}, null, 2));
                    }}
                    className="mt-1 block w-full border border-black/45 bg-white px-2 py-2 text-[12px] dark:border-white/40 dark:bg-background"
                  >
                    {actions.map((entry) => (
                      <option key={entry.name} value={entry.name}>
                        {entry.label} · {entry.risk}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Resource
                </span>
                <input
                  name="resource"
                  value={resource}
                  onChange={(event) => setResource(event.target.value)}
                  placeholder="demo/checkout"
                  className="mt-1 block w-full border border-black/45 bg-white px-2 py-2 font-mono text-[12px] dark:border-white/40 dark:bg-background"
                />
                <span className="mt-1 block text-[10px] text-black/60 dark:text-muted-foreground">
                  Checked against the grant&apos;s resource pattern.
                </span>
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                  Input (JSON)
                </span>
                <textarea
                  name="input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={7}
                  spellCheck={false}
                  className="mt-1 block w-full border border-black/45 bg-white px-2 py-2 font-mono text-[11px] leading-relaxed dark:border-white/40 dark:bg-background"
                />
                <span className="mt-1 block text-[10px] text-black/60 dark:text-muted-foreground">
                  {action?.fields.length
                    ? `Fields: ${action.fields.map((field) => `${field.key}${field.required ? "*" : ""}`).join(", ")}. `
                    : ""}
                  Amount conditions read numeric fields from this object.
                </span>
              </label>

              {agent && !agentReady ? (
                <p className="border border-[#b3402f]/30 bg-[#b3402f]/[0.06] px-3 py-2 text-[12px] text-[#8c3225] dark:text-[#f0a396]">
                  {agent.status !== "active"
                    ? `${agent.name} is ${agent.status}. Resume it before running a call.`
                    : `${agent.name} holds its own private key. Run this from your backend with a signed challenge.`}
                </p>
              ) : null}

              {needsGrant || !hasConnection ? (
                <p className="border border-black/45 bg-[#faf9f6] px-3 py-2 text-[12px] leading-relaxed text-black/60 dark:border-white/40 dark:bg-background dark:text-muted-foreground">
                  {!hasConnection ? "The first run creates a sandbox connection row with no stored secret. " : ""}
                  {needsGrant
                    ? `It also creates a sandbox-only grant for ${agent?.name ?? "this agent"} covering sandbox.*. Both are recorded in the audit log.`
                    : ""}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={pending || !agentReady}
                  className="border border-black bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black disabled:opacity-50"
                >
                  {pending ? "Running…" : "Run sandbox call"}
                </button>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/60 dark:text-muted-foreground">
                  {environmentType === "production"
                    ? "Production: every non-read action needs approval"
                    : "Development: read and write auto-allow; the rest need approval"}
                </span>
              </div>
            </fieldset>
          </form>
        </section>

        <section aria-live="polite" className="border border-black/10 bg-white dark:border-border dark:bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-border">
            <div>
              <h2 className="text-[13px] font-medium">Result</h2>
              <p className="mt-0.5 text-[11px] text-black/60 dark:text-muted-foreground">
                The proxy&apos;s answer, verbatim.
              </p>
            </div>
            {state?.httpStatus ? (
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                <span
                  className={`border px-1.5 py-0.5 ${
                    state.ok
                      ? "border-[#2f7d5c]/30 text-[#276a4e] dark:text-[#7fd1ab]"
                      : "border-[#b3402f]/35 text-[#b3402f]"
                  }`}
                >
                  HTTP {state.httpStatus}
                </span>
                {state.durationMs !== undefined ? (
                  <span className="text-black/60 dark:text-muted-foreground">{state.durationMs} ms</span>
                ) : null}
              </div>
            ) : null}
          </header>

          <div className="p-4 sm:p-5">
            {!state ? (
              <p className="text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
                Nothing has run yet. Pick an action and a sample input, then run the call. The response, the policy
                decision and the request ID will appear here.
              </p>
            ) : state.error ? (
              <p className="border border-[#b3402f]/30 bg-[#b3402f]/[0.06] px-3 py-2 text-[12px] text-[#8c3225] dark:text-[#f0a396]">
                {state.error}
              </p>
            ) : (
              <div className="space-y-4">
                {state.provisioned ? (
                  <p className="border border-black/45 bg-[#faf9f6] px-3 py-2 text-[11px] leading-relaxed text-black/65 dark:border-white/40 dark:bg-background dark:text-muted-foreground">
                    Provisioned the sandbox connection and a sandbox-only grant for this agent.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {responseStatus ? <StatusBadge status={responseStatus === "executed" ? "allowed" : responseStatus} /> : null}
                  {errorCode ? (
                    <span className="border border-[#b3402f]/35 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#b3402f]">
                      {errorCode}
                    </span>
                  ) : null}
                  {decisionRisk ? <RiskBadge risk={decisionRisk} /> : null}
                  {decisionSource ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                      {decisionSource}
                    </span>
                  ) : null}
                </div>

                {responseStatus === "pending_approval" && approvalId ? (
                  <div className="border border-[#a56b18]/30 bg-[#a56b18]/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-[#6b4a12] dark:text-[#e0b36a]">
                    Waiting on a human decision.{" "}
                    <Link href={`/app/approvals/${approvalId}`} className="underline">
                      Open the approval
                    </Link>
                    . Approving executes this stored sandbox call.
                  </div>
                ) : null}

                {errorMessage ? (
                  <div className="border border-[#b3402f]/30 bg-[#b3402f]/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-[#8c3225] dark:text-[#f0a396]">
                    <p>{errorMessage}</p>
                    {decisionReason ? <p className="mt-1 text-[11px] opacity-80">{decisionReason}</p> : null}
                  </div>
                ) : null}

                {result ? (
                  <div>
                    <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
                      Sandbox response
                    </p>
                    <pre className="max-h-80 overflow-auto border border-black/10 bg-[#0b0b0b] p-3 font-mono text-[10px] leading-relaxed text-[#e8e6e1] dark:border-border">
                      {JSON.stringify(result.body ?? null, null, 2)}
                    </pre>
                    {result.truncated ? (
                      <p className="mt-1 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        Response truncated at 2 MB.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/10 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:border-border dark:text-muted-foreground">
                  {state.requestId ? <span>Request {state.requestId}</span> : null}
                  <Link href="/app/activity?action=sandbox.call" className="underline">
                    Audit chain
                  </Link>
                  <Link href="/app/policy" className="underline">
                    Policy lab
                  </Link>
                </div>

                <details className="border-t border-black/10 pt-3 dark:border-border">
                  <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:text-muted-foreground">
                    Raw proxy response
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto border border-black/10 bg-[#faf9f6] p-3 font-mono text-[10px] leading-relaxed dark:border-border dark:bg-background">
                    {JSON.stringify(state.payload, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="min-w-0 space-y-6">
        <section className="border border-black/10 bg-white dark:border-border dark:bg-card">
          <header className="border-b border-black/10 px-4 py-3 dark:border-border">
            <h2 className="text-[13px] font-medium">Sample apps</h2>
            <p className="mt-0.5 text-[11px] text-black/60 dark:text-muted-foreground">
              Start from a realistic agent, then edit the request.
            </p>
          </header>
          <div className="divide-y divide-black/10 dark:divide-border">
            {SANDBOX_SAMPLE_APPS.map((sample) => {
              const target = actions.find((entry) => entry.name === sample.action);
              return (
                <div key={sample.id} className="p-4">
                  <div className="flex items-start gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center bg-black font-mono text-[10px] tracking-[0.08em] text-white dark:bg-foreground dark:text-background">
                      {sample.mark}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-medium">{sample.name}</p>
                        {target ? <RiskBadge risk={target.risk} /> : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
                        {sample.description}
                      </p>
                      <p className="mt-1.5 font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                        {sample.action}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActionName(sample.action);
                          setResource(sample.resource);
                          setInput(JSON.stringify(sample.input, null, 2));
                        }}
                        className="mt-2 border border-black/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] hover:border-black dark:border-white/40 dark:hover:border-foreground"
                      >
                        Use sample
                      </button>
                    </div>
                  </div>
                  <p className="mt-2.5 border-t border-black/10 pt-2 text-[10px] leading-relaxed text-black/60 dark:border-border dark:text-muted-foreground">
                    {sample.note}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border border-black/10 bg-white dark:border-border dark:bg-card">
          <header className="border-b border-black/10 px-4 py-3 dark:border-border">
            <h2 className="text-[13px] font-medium">Call it from code</h2>
            <p className="mt-0.5 text-[11px] text-black/60 dark:text-muted-foreground">
              The same endpoint your agents use. Issue a token at{" "}
              <span className="font-mono">POST /api/v1/agents/&#123;id&#125;/token</span>.
            </p>
          </header>
          <pre className="max-h-80 overflow-auto p-4 font-mono text-[10px] leading-relaxed text-black/70 dark:text-muted-foreground">
            {snippet}
          </pre>
        </section>
      </div>
    </div>
  );
}
