import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { actionLabel } from "@/lib/audit";
import { SANDBOX_CONNECTOR } from "@/lib/connectors";
import { EmptyState, PageHeader, Panel, StatusBadge, relativeTime } from "@/components/app/ui";
import { PlaygroundClient } from "./playground-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Playground" };

function parseSummary(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export default async function PlaygroundPage() {
  const ctx = await getContext();

  const [agents, connection, recent] = await Promise.all([
    db.agent.findMany({
      where: { environmentId: ctx.environment.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, keyMode: true },
    }),
    db.credential.findFirst({
      where: { environmentId: ctx.environment.id, connectorSlug: "sandbox" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    db.auditEvent.findMany({
      where: { environmentId: ctx.environment.id, action: "sandbox.call" },
      orderBy: { seq: "desc" },
      take: 5,
      select: { id: true, seq: true, outcome: true, timestamp: true, payloadSummary: true, requestId: true },
    }),
  ]);

  const grants = connection
    ? await db.grant.findMany({
        where: {
          environmentId: ctx.environment.id,
          credentialId: connection.id,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { agentId: true },
      })
    : [];
  const grantedAgents = new Set(grants.map((grant) => grant.agentId));

  const canRun =
    ctx.capabilities.manageAgents && ctx.capabilities.manageCredentials && ctx.capabilities.manageGrants;

  const actions = SANDBOX_CONNECTOR.actions.map((action) => ({
    name: action.name,
    label: action.label,
    risk: action.risk,
    description: action.description,
    fields: (action.fields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      placeholder: field.placeholder ?? "",
      required: field.required === true,
    })),
  }));

  return (
    <div>
      <PageHeader
        eyebrow={`Build · sandbox · ${ctx.environment.type}`}
        title="Prove the gate before the wire."
        description="Run a real proxied call before you store a provider key. Agent auth, grants, scopes, policy, approvals, rate limits and the audit chain all run. No secret is read and no host is contacted."
        actions={
          <>
            <Link
              href="/app/agents/new"
              className="border border-black/45 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-white/40 dark:bg-card"
            >
              Register agent
            </Link>
            <Link
              href="/app/developers"
              className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
            >
              Agent tokens
            </Link>
          </>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          title="Register an agent first."
          description="The playground runs as one of your agents, so its grants, scopes and policy apply. Register an agent, then come back and run a sandbox call."
          action={
            <Link
              href="/app/agents/new"
              className="border border-black bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#eca8d6] hover:text-black"
            >
              Register agent
            </Link>
          }
        />
      ) : (
        <PlaygroundClient
          canRun={canRun}
          hasConnection={Boolean(connection)}
          environmentType={ctx.environment.type}
          agents={agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            keyMode: agent.keyMode,
            hasGrant: grantedAgents.has(agent.id),
          }))}
          actions={actions}
        />
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Recent sandbox calls"
          hint="Chained into this environment's audit log"
          actions={
            <Link href="/app/activity?action=sandbox.call" className="font-mono text-[10px] uppercase tracking-[0.14em] underline">
              Audit log
            </Link>
          }
          bodyClassName="p-0"
        >
          {recent.length ? (
            <div className="divide-y divide-black/10 dark:divide-border">
              {recent.map((event) => {
                const payload = parseSummary(event.payloadSummary);
                const action = typeof payload.action === "string" ? payload.action : "sandbox.call";
                return (
                  <Link
                    key={event.id}
                    href={`/app/activity/${event.id}`}
                    title="Open the call trust view"
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12px] transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">#{event.seq}</span>
                    <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">
                      {actionLabel("sandbox.call")}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-black/60 dark:text-muted-foreground">
                      {action}
                    </span>
                    <StatusBadge status={event.outcome} />
                    <span className="font-mono text-[9px] text-black/60 dark:text-muted-foreground">
                      {relativeTime(event.timestamp)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-6 text-[12px] leading-relaxed text-black/60 dark:text-muted-foreground">
              No sandbox calls yet. The first run appears here and in the tamper-evident audit chain.
            </p>
          )}
        </Panel>

        <Panel title="What the sandbox proves" hint="And what it deliberately avoids">
          <ul className="space-y-2 text-[12px] leading-relaxed">
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-[#276a4e] dark:text-[#7fd1ab]">✓</span>
              <span>
                A real agent token is issued, its scopes are checked, and the full policy pipeline runs — grants,
                resource patterns, IP and time conditions, amount caps and call caps.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-[#276a4e] dark:text-[#7fd1ab]">✓</span>
              <span>
                Approval policies apply. Approving a request executes the stored sandbox call and records it against
                the approver.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-[#276a4e] dark:text-[#7fd1ab]">✓</span>
              <span>Environment rate limits, plan gates and kill switches apply exactly as they do live.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-black/60 dark:text-muted-foreground">—</span>
              <span>
                No stored secret is decrypted, no network request is made, and the run is not counted toward billable
                calls. It still lands in the audit log.
              </span>
            </li>
          </ul>
          <p className="mt-4 border-t border-black/10 pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 dark:border-border dark:text-muted-foreground">
            Responses are synthetic. Policy, approvals and audit are not.
          </p>
        </Panel>
      </div>
    </div>
  );
}
