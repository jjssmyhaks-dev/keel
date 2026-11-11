import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { envSettings } from "@/lib/policy";
import {
  updateEnvironmentSettingsAction,
  addAlertRuleAction,
  toggleAlertRuleAction,
  runAlertChecksAction,
  verifyAuditAction,
} from "@/app/app/actions";
import { PageHeader, Panel, Stat, StatusBadge, Notice, formatDate } from "@/components/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Security" };

const ALERT_TYPES = [
  { value: "call_spike", label: "Call spike", detail: "More calls than usual in a window." },
  { value: "repeated_denials", label: "Repeated denials", detail: "An agent keeps hitting policy walls." },
  { value: "new_host", label: "New host", detail: "A connection reaches a host it has not used before." },
  { value: "credential_expiring", label: "Credential expiring", detail: "A token or key is nearing expiry." },
];

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getContext();
  const query = await searchParams;
  const settings = envSettings(ctx.environment);
  const canManage = ctx.capabilities.manageSecurity;

  const [alerts, auditCount, pendingApprovals, activeAgents] = await Promise.all([
    db.alertRule.findMany({ where: { environmentId: ctx.environment.id }, orderBy: { createdAt: "desc" } }),
    db.auditEvent.count({ where: { environmentId: ctx.environment.id } }),
    db.approvalRequest.count({ where: { environmentId: ctx.environment.id, status: "pending" } }),
    db.agent.count({ where: { environmentId: ctx.environment.id, status: "active" } }),
  ]);

  const lastVerified = await db.auditEvent.findFirst({
    where: { environmentId: ctx.environment.id, action: "audit.verified" },
    orderBy: { seq: "desc" },
  });

  const ipAllowlist = settings.ipAllowlist ?? "";
  const allowedDomains = settings.allowedDomains ?? "";

  return (
    <div>
      <PageHeader
        eyebrow={`Security · ${ctx.environment.type} environment`}
        title="Assume the agent is compromised."
        description="These settings decide what happens after a bad token: how fast approvals expire, how hard calls are rate-limited and who can act."
        actions={
          <Link href="/app/activity" className="border border-black/15 bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] hover:border-black dark:border-border dark:bg-card">
            Activity log
          </Link>
        }
      />

      {query.error ? (
        <Notice kind="error">
          {query.error === "slack"
            ? "Enter a full https://hooks.slack.com/services/... webhook URL."
            : query.error === "channels"
              ? "Pick at least one delivery channel for the alert rule."
              : "Only owners and admins can change security settings."}
        </Notice>
      ) : null}
      {query.saved ? <Notice kind="ok">Security settings saved. They apply to new calls immediately.</Notice> : null}
      {query.checked !== undefined ? (
        <Notice kind="ok">
          {query.checked === "0"
            ? "Alert rules evaluated. Nothing crossed its threshold."
            : `${query.checked} alert${query.checked === "1" ? "" : "s"} fired and was delivered to its channels.`}
        </Notice>
      ) : null}
      {query.verified === "ok" ? (
        <Notice kind="ok">Audit chain verified over {query.checked} events.</Notice>
      ) : null}
      {query.verified === "broken" ? <Notice kind="error">Audit chain is broken. Investigate before trusting this environment.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active agents" value={activeAgents} detail={`${pendingApprovals} awaiting approval`} accent />
        <Stat label="Audit events" value={auditCount} detail="Hash-chained, append-only" />
        <Stat label="Rate limit" value={`${settings.agentRateLimitPerMinute ?? 120}/min`} detail="Per agent, at the proxy" />
        <Stat label="Approval TTL" value={`${settings.approvalExpiryMinutes ?? 60}m`} detail="Then the request expires" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Proxy guardrails" hint="Enforced on every call" bodyClassName="p-4">
            <p className="mb-4 border border-black/10 bg-[#faf9f6] p-3 text-[11px] leading-relaxed text-black/55 dark:border-border dark:bg-background dark:text-muted-foreground">
              Provider calls are live. Every request is evaluated against grants, risk class, rate limits and approvals
              before Authab decrypts a credential and calls the provider. Responses are capped at 2 MB and redirects must
              stay on the credential&apos;s own origin.
            </p>
            <form action={updateEnvironmentSettingsAction} className="space-y-4">

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="approvalExpiryMinutes" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Approval expiry (minutes)
                  </label>
                  <input
                    id="approvalExpiryMinutes"
                    name="approvalExpiryMinutes"
                    type="number"
                    min={5}
                    max={1440}
                    defaultValue={settings.approvalExpiryMinutes ?? 60}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                </div>
                <div>
                  <label htmlFor="agentRateLimitPerMinute" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                    Per-agent calls / minute
                  </label>
                  <input
                    id="agentRateLimitPerMinute"
                    name="agentRateLimitPerMinute"
                    type="number"
                    min={10}
                    max={5000}
                    defaultValue={settings.agentRateLimitPerMinute ?? 120}
                    className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-black dark:border-border dark:bg-background"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="allowedDomains" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                  Outbound domain allow-list
                </label>
                <input
                  id="allowedDomains"
                  name="allowedDomains"
                  defaultValue={allowedDomains}
                  placeholder="api.stripe.com, slack.com"
                  className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
                <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">
                  Empty means only the connector&apos;s documented hosts. Anything else is refused before execution.
                </p>
              </div>

              <div>
                <label htmlFor="ipAllowlist" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                  Inbound IP allow-list
                </label>
                <input
                  id="ipAllowlist"
                  name="ipAllowlist"
                  defaultValue={ipAllowlist}
                  placeholder="203.0.113., 10.0.0."
                  className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
                <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">
                  Prefix match on the client IP. Leave blank unless agents run from a fixed egress range.
                </p>
              </div>

              <div>
                <label htmlFor="slackWebhookUrl" className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/45 dark:text-muted-foreground">
                  Slack webhook for alerts
                </label>
                <input
                  id="slackWebhookUrl"
                  name="slackWebhookUrl"
                  defaultValue={settings.slackWebhookUrl ?? ""}
                  placeholder="https://hooks.slack.com/services/…"
                  className="mt-1 w-full border border-black/15 bg-[#faf9f6] px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-black dark:border-border dark:bg-background"
                />
                <p className="mt-1 text-[10px] text-black/40 dark:text-muted-foreground">
                  Used only by alert rules that select the Slack channel. Leave blank to disable Slack delivery.
                </p>
              </div>

              <button
                disabled={!canManage}
                className="border border-black bg-black px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black disabled:opacity-40"
              >
                Save guardrails
              </button>
            </form>
          </Panel>

          <Panel
            title="Alert rules"
            hint="Evaluated by the cron sweep or on demand"
            actions={
              canManage ? (
                <form action={runAlertChecksAction}>
                  <button className="border border-black/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] hover:border-black dark:border-border">
                    Run checks now
                  </button>
                </form>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-black/35 dark:text-muted-foreground">
                  {alerts.length} configured
                </span>
              )
            }
            bodyClassName="p-0"
          >
            {alerts.length ? (
              <div className="divide-y divide-black/10 dark:divide-border">
                {alerts.map((alert) => {
                  const config = JSON.parse(alert.configJson || "{}") as { threshold?: number; windowMinutes?: number };
                  const channels = JSON.parse(alert.channelsJson || "[]") as string[];
                  const meta = ALERT_TYPES.find((type) => type.value === alert.type);
                  return (
                    <div key={alert.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <StatusBadge status={alert.enabled ? "active" : "paused"} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px]">{meta?.label ?? alert.type}</p>
                        <p className="font-mono text-[9px] text-black/40 dark:text-muted-foreground">
                          {config.threshold ? `> ${config.threshold} in ${config.windowMinutes ?? 60}m` : "default threshold"} ·{" "}
                          {channels.join(", ") || "no channels"} · created {formatDate(alert.createdAt)}
                          {alert.lastFiredAt ? ` · last fired ${formatDate(alert.lastFiredAt)}` : ""}
                        </p>
                      </div>
                      {canManage ? (
                        <form action={toggleAlertRuleAction}>
                          <input type="hidden" name="ruleId" value={alert.id} />
                          <button className="border border-black/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] hover:border-black dark:border-border">
                            {alert.enabled ? "Disable" : "Enable"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-5 text-[11px] leading-relaxed text-black/45 dark:text-muted-foreground">
                No alert rules. Denials and approval timeouts are always audited, but nothing will page a human.
              </p>
            )}
            {canManage ? (
              <form action={addAlertRuleAction} className="flex flex-wrap items-end gap-2 border-t border-black/10 px-4 py-3 dark:border-border">
                <div>
                  <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">Signal</label>
                  <select name="type" className="mt-1 block border border-black/15 bg-white px-2 py-1 text-[11px] dark:border-border dark:bg-card">
                    {ALERT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">Threshold</label>
                  <input
                    name="threshold"
                    type="number"
                    min={1}
                    defaultValue={3}
                    className="mt-1 block w-20 border border-black/15 bg-white px-2 py-1 font-mono text-[11px] dark:border-border dark:bg-card"
                  />
                </div>
                <div>
                  <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">Window (min)</label>
                  <input
                    name="windowMinutes"
                    type="number"
                    min={5}
                    defaultValue={60}
                    className="mt-1 block w-20 border border-black/15 bg-white px-2 py-1 font-mono text-[11px] dark:border-border dark:bg-card"
                  />
                </div>
                <div>
                  <label className="font-mono text-[8px] uppercase tracking-[0.16em] text-black/40 dark:text-muted-foreground">Channels</label>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="channels" value="email" defaultChecked className="size-3.5 accent-black" />
                      email
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="channels" value="slack" className="size-3.5 accent-black" />
                      slack
                    </label>
                  </div>
                </div>
                <button className="border border-black bg-black px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                  Add rule
                </button>
              </form>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Audit integrity" hint="Hash chain, per environment" bodyClassName="p-4">
            <p className="text-[11px] leading-relaxed text-black/50 dark:text-muted-foreground">
              {lastVerified
                ? `Last verification ${formatDate(lastVerified.timestamp)} by ${lastVerified.actorName}.`
                : "This environment has not been verified since it was created."}
            </p>
            <form action={verifyAuditAction} className="mt-3">
              <input type="hidden" name="back" value="/app/security" />
              <button className="w-full border border-black bg-black px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white hover:bg-[#eca8d6] hover:text-black">
                Verify now
              </button>
            </form>
            <div className="mt-3 space-y-1.5 border-t border-black/10 pt-3 font-mono text-[9px] text-black/45 dark:border-border dark:text-muted-foreground">
              <p>{auditCount} events in chain</p>
              <p>SHA-256 · prev-hash chained</p>
              <p>
                Export:{" "}
                <a href="/app/activity/export?format=jsonl" className="underline">
                  JSONL
                </a>{" "}
                ·{" "}
                <a href="/app/activity/export?format=csv" className="underline">
                  CSV
                </a>
              </p>
            </div>
          </Panel>

          <Panel title="Who can do what" hint="Role capabilities" bodyClassName="p-0">
            <div className="divide-y divide-black/10 text-[11px] dark:divide-border">
              {[
                { label: "Approve requests", roles: "Owner · Admin · Approver" },
                { label: "Register agents", roles: "Owner · Admin · Developer" },
                { label: "Add connections", roles: "Owner · Admin · Developer" },
                { label: "Write in production", roles: "Owner · Admin" },
                { label: "Manage team", roles: "Owner · Admin" },
                { label: "Billing", roles: "Owner" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span>{row.label}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-black/45 dark:text-muted-foreground">{row.roles}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-black/10 px-4 py-2.5 dark:border-border">
              <Link href="/app/team" className="font-mono text-[9px] uppercase tracking-[0.12em] underline-offset-2 hover:underline">
                Manage roles
              </Link>
            </div>
          </Panel>

          <Panel title="Secrets handling" hint="Envelope encryption" bodyClassName="p-4">
            <ul className="space-y-2 text-[11px] leading-relaxed text-black/55 dark:text-muted-foreground">
              <li>Master key → project key → per-credential data key.</li>
              <li>AES-256-GCM with authenticated encryption on every payload.</li>
              <li>Secrets are injected inside the proxy; agent processes never receive them.</li>
              <li>Agent private keys are sealed with the same envelope when Authab-managed.</li>
              <li>Logs redact connector-specific fields before they are written.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
