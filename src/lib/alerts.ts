import { db } from "./db";
import { auditEvent } from "./audit";
import { emailLayout, sendEmail, appUrl } from "./email";
import { envSettings } from "./policy";

export const ALERT_LABELS: Record<string, string> = {
  call_spike: "Call spike",
  repeated_denials: "Repeated denials",
  new_host: "New host",
  credential_expiring: "Credential expiring",
  credential_broken: "Credential broken",
};

export type FiredAlert = { ruleId: string; type: string; environmentId: string; message: string };

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function recentCallEvents(environmentId: string, since: Date) {
  const events = await db.auditEvent.findMany({
    where: { environmentId, action: "proxy.call", timestamp: { gte: since } },
    select: { payloadSummary: true, outcome: true, timestamp: true },
    orderBy: { timestamp: "desc" },
    take: 2000,
  });
  return events.map((event) => ({
    host: (parseJson<Record<string, unknown>>(event.payloadSummary, {}).host as string | undefined) ?? null,
    outcome: event.outcome,
    timestamp: event.timestamp,
  }));
}

async function priorHosts(environmentId: string, before: Date) {
  const events = await db.auditEvent.findMany({
    where: { environmentId, action: "proxy.call", timestamp: { lt: before } },
    select: { payloadSummary: true },
    orderBy: { timestamp: "desc" },
    take: 2000,
  });
  const hosts = new Set<string>();
  for (const event of events) {
    const host = parseJson<Record<string, unknown>>(event.payloadSummary, {}).host;
    if (typeof host === "string" && host) hosts.add(host);
  }
  return hosts;
}

async function deliver(opts: {
  ruleId: string;
  environmentId: string;
  orgId: string;
  title: string;
  body: string;
  channels: string[];
  slackWebhookUrl?: string;
}) {
  const members = await db.membership.findMany({
    where: { orgId: opts.orgId, role: { in: ["owner", "admin", "approver"] } },
    include: { user: true },
  });

  if (opts.channels.includes("email") && members.length) {
    await Promise.all(
      members.map((member) =>
        sendEmail({
          to: member.user.email,
          subject: opts.title,
          html: emailLayout(opts.title, `<p>${opts.body}</p><p style="margin:24px 0"><a href="${appUrl("/app/security")}">Open security settings</a></p>`),
          text: `${opts.body}\n${appUrl("/app/security")}`,
        }).catch(() => null),
      ),
    );
  }

  if (opts.channels.includes("slack") && opts.slackWebhookUrl) {
    await fetch(opts.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${opts.title}*\n${opts.body}\n${appUrl("/app/security")}` }),
      signal: AbortSignal.timeout(5000),
    }).catch((error) => console.error("[authab:alerts] slack delivery failed", error));
  }

  if (members.length) {
    await db.notification.createMany({
      data: members.map((member) => ({
        orgId: opts.orgId,
        userId: member.userId,
        type: "alert",
        title: opts.title,
        body: opts.body,
        href: "/app/security",
      })),
    });
  }

  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "system",
    actorId: opts.ruleId,
    actorName: "Alert rule",
    action: "alert.fired",
    resourceType: "alert_rule",
    resourceId: opts.ruleId,
    outcome: "recorded",
    payloadSummary: { title: opts.title, detail: opts.body, channels: opts.channels },
  }).catch(() => null);
}

export async function evaluateAlerts(environmentId?: string): Promise<FiredAlert[]> {
  const rules = await db.alertRule.findMany({
    where: { enabled: true, ...(environmentId ? { environmentId } : {}) },
    include: { environment: { include: { project: { select: { orgId: true } } } } },
  });

  const fired: FiredAlert[] = [];
  for (const rule of rules) {
    const config = parseJson<{ threshold?: number; windowMinutes?: number }>(rule.configJson, {});
    const threshold = Math.max(Number(config.threshold ?? 3), 1);
    const windowMinutes = Math.max(Number(config.windowMinutes ?? 60), 5);
    const since = new Date(Date.now() - windowMinutes * 60_000);

    let message: string | null = null;
    let dedupeMs = Math.max(windowMinutes * 60_000, 60_000);

    if (rule.type === "call_spike") {
      const count = await db.auditEvent.count({
        where: { environmentId: rule.environmentId, action: "proxy.call", timestamp: { gte: since } },
      });
      if (count >= threshold) {
        message = `${count} proxy calls in the last ${windowMinutes} minutes (threshold ${threshold}).`;
      }
    } else if (rule.type === "repeated_denials") {
      const count = await db.auditEvent.count({
        where: {
          environmentId: rule.environmentId,
          action: "proxy.call",
          outcome: "denied",
          timestamp: { gte: since },
        },
      });
      if (count >= threshold) {
        message = `${count} denied proxy calls in the last ${windowMinutes} minutes (threshold ${threshold}).`;
      }
    } else if (rule.type === "new_host") {
      const recent = await recentCallEvents(rule.environmentId, since);
      const seen = await priorHosts(rule.environmentId, since);
      const hosts = [...new Set(recent.map((event) => event.host).filter((host): host is string => Boolean(host)))];
      const fresh = hosts.filter((host) => !seen.has(host));
      if (fresh.length) {
        message = `New outbound host${fresh.length === 1 ? "" : "s"} contacted: ${fresh.join(", ")}.`;
        dedupeMs = 24 * 60 * 60_000;
      }
    } else if (rule.type === "credential_broken") {
      const credentials = await db.credential.findMany({
        where: { environmentId: rule.environmentId, revokedAt: null, status: "broken" },
        select: { name: true, connectorSlug: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (credentials.length) {
        message = `${credentials.length} connection${credentials.length === 1 ? "" : "s"} failing provider checks: ${credentials
          .slice(0, 5)
          .map((credential) => `${credential.name} (${credential.connectorSlug})`)
          .join(", ")}${credentials.length > 5 ? "…" : ""}.`;
        dedupeMs = 24 * 60 * 60_000;
      }
    } else if (rule.type === "credential_expiring") {
      const days = Math.max(threshold, 1);
      const credentials = await db.credential.findMany({
        where: {
          environmentId: rule.environmentId,
          revokedAt: null,
          expiresAt: { not: null, lte: new Date(Date.now() + days * 86400_000) },
        },
        select: { name: true, connectorSlug: true, expiresAt: true },
        orderBy: { expiresAt: "asc" },
      });
      if (credentials.length) {
        message = `${credentials.length} connection${credentials.length === 1 ? "" : "s"} expiring within ${days} days: ${credentials
          .slice(0, 5)
          .map((credential) => `${credential.name} (${credential.connectorSlug})`)
          .join(", ")}${credentials.length > 5 ? "…" : ""}.`;
        dedupeMs = 24 * 60 * 60_000;
      }
    }

    if (!message) continue;
    if (rule.lastFiredAt && Date.now() - rule.lastFiredAt.getTime() < dedupeMs) continue;

    const channels = parseJson<string[]>(rule.channelsJson, ["email"]);
    const title = `Alert: ${ALERT_LABELS[rule.type] ?? rule.type}`;
    await deliver({
      ruleId: rule.id,
      environmentId: rule.environmentId,
      orgId: rule.environment.project.orgId,
      title,
      body: message,
      channels,
      slackWebhookUrl: envSettings(rule.environment).slackWebhookUrl,
    });
    await db.alertRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } });
    fired.push({ ruleId: rule.id, type: rule.type, environmentId: rule.environmentId, message });
  }

  return fired;
}
