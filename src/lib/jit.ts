import type { Agent, Credential, Environment } from "@prisma/client";
import { db } from "./db";
import { randomToken } from "./crypto";
import { type Risk } from "./connectors";
import { resolveConnector } from "./custom-connectors";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { notifyApprovers } from "./notifications";
import { emailLayout, sendEmail } from "./email";
import { approvalSlaFor, envSettings } from "./policy";
import { approvalUrlFor } from "./signed-links";

const RISK_ORDER: Record<Risk, number> = { read: 1, write: 2, admin: 3, destructive: 4, financial: 5 };

export async function requestJustInTimeGrant(opts: {
  environment: Environment;
  orgId: string;
  agent: Agent;
  credential: Credential;
  actions: string[];
  resourcePattern?: string;
  reason: string;
  durationMinutes?: number;
  requestId: string;
}): Promise<
  | { ok: true; approvalId: string; grantId: string; approvalUrl: string; expiresAt: string }
  | { ok: false; error: string; code: string }
> {
  const connectorDef = await resolveConnector(opts.credential.connectorSlug, opts.environment.id);
  if (!connectorDef) return { ok: false, code: "unknown_connector", error: "Unknown connector." };

  const actions = [...new Set(opts.actions.map((action) => action.trim()).filter(Boolean))];
  if (!actions.length) {
    return { ok: false, code: "actions_required", error: "Request at least one action." };
  }
  const unknown = actions.find((action) => !connectorDef.actions.some((entry) => entry.name === action));
  if (unknown) {
    return {
      ok: false,
      code: "invalid_actions",
      error: `“${unknown}” is not in the ${connectorDef.name} action catalogue.`,
    };
  }
  if (opts.credential.revokedAt || opts.credential.status === "revoked") {
    return { ok: false, code: "credential_revoked", error: "This connection was revoked." };
  }
  if (opts.credential.status === "broken") {
    return { ok: false, code: "credential_unhealthy", error: opts.credential.healthDetail ?? "This connection is unhealthy." };
  }

  const durationMinutes = Math.max(5, Math.min(Number(opts.durationMinutes ?? 60) || 60, 1440));
  const existing = await db.grant.findUnique({
    where: { agentId_credentialId: { agentId: opts.agent.id, credentialId: opts.credential.id } },
  });
  const now = new Date();
  if (existing && !existing.justInTime) {
    return {
      ok: false,
      code: "grant_exists",
      error: "This agent already has standing access to the connection. Use the grant instead.",
    };
  }
  if (existing?.activatedAt && (!existing.expiresAt || existing.expiresAt > now)) {
    return {
      ok: false,
      code: "grant_active",
      error: `Just-in-time access is already active${existing.expiresAt ? ` until ${existing.expiresAt.toISOString()}` : ""}.`,
    };
  }
  if (existing) {
    const pending = await db.approvalRequest.findFirst({
      where: { grantId: existing.id, kind: "grant", status: "pending" },
      select: { id: true },
    });
    if (pending) {
      return {
        ok: false,
        code: "request_pending",
        error: "A just-in-time request for this connection is already waiting on an approver.",
      };
    }
  }

  const resourcePattern = opts.resourcePattern?.trim() || "*";
  const grant = await db.grant.upsert({
    where: { agentId_credentialId: { agentId: opts.agent.id, credentialId: opts.credential.id } },
    update: {
      actionsJson: JSON.stringify(actions),
      resourcePattern,
      purpose: opts.reason.slice(0, 200),
      justInTime: true,
      activatedAt: null,
    },
    create: {
      environmentId: opts.environment.id,
      agentId: opts.agent.id,
      credentialId: opts.credential.id,
      actionsJson: JSON.stringify(actions),
      resourcePattern,
      purpose: opts.reason.slice(0, 200),
      justInTime: true,
      activatedAt: null,
    },
  });

  const risk = actions.reduce<Risk>((highest, action) => {
    const actionRisk = connectorDef.actions.find((entry) => entry.name === action)?.risk ?? "read";
    return RISK_ORDER[actionRisk] > RISK_ORDER[highest] ? actionRisk : highest;
  }, "read");

  const settings = envSettings(opts.environment);
  const minutes = settings.approvalExpiryMinutes ?? 60;
  const sla = await approvalSlaFor({
    environmentId: opts.environment.id,
    agentId: opts.agent.id,
    actionName: "grant.request",
    fallbackMinutes: settings.escalateAfterMinutes ?? null,
  });
  const slaMinutes = sla.minutes ? Math.max(1, Math.min(sla.minutes, minutes - 1)) : null;
  const slaDueAt = slaMinutes ? new Date(now.getTime() + slaMinutes * 60_000) : null;
  const summary = `${opts.agent.name} requests just-in-time access to ${connectorDef.name} for ${durationMinutes} minutes.`;
  const grantSpec = { actions, resourcePattern, durationMinutes };
  const token = `apr_${randomToken(24)}`;

  const approval = await db.approvalRequest.create({
    data: {
      environmentId: opts.environment.id,
      agentId: opts.agent.id,
      grantId: grant.id,
      credentialId: opts.credential.id,
      action: "grant.request",
      summary,
      payloadJson: JSON.stringify({
        grantSpec,
        reason: opts.reason,
        connector: opts.credential.connectorSlug,
        credentialId: opts.credential.id,
        requestId: opts.requestId,
      }),
      redactedJson: JSON.stringify({ actions, resourcePattern, durationMinutes }),
      risk,
      token,
      requestId: opts.requestId,
      kind: "grant",
      grantSpecJson: JSON.stringify(grantSpec),
      slaDueAt,
      expiresAt: new Date(now.getTime() + minutes * 60_000),
    },
  });

  await auditEvent({
    environmentId: opts.environment.id,
    actorType: "agent",
    actorId: opts.agent.id,
    actorName: opts.agent.name,
    agentId: opts.agent.id,
    action: "grant.requested",
    resourceType: "grant",
    resourceId: grant.id,
    outcome: "recorded",
    requestId: opts.requestId,
    payloadSummary: {
      approvalId: approval.id,
      connector: opts.credential.connectorSlug,
      actions,
      resourcePattern,
      durationMinutes,
      risk,
      reason: opts.reason,
    },
  });

  await notifyApprovers({
    orgId: opts.orgId,
    title: "Just-in-time access requested",
    body: summary,
    href: `/app/approvals/${approval.id}`,
  });

  const approvers = await db.membership.findMany({
    where: { orgId: opts.orgId, role: { in: ["owner", "admin", "approver"] } },
    include: { user: true },
  });
  const link = approvalUrlFor(token);
  await Promise.all(
    approvers.map((member) =>
      sendEmail({
        to: member.user.email,
        subject: `Just-in-time access: ${connectorDef.name}`,
        html: emailLayout(
          "Just-in-time access requested",
          `<p>${summary}</p>
           <p style="color:#8b8b8b;font-size:13px">Actions: ${actions.join(", ")} · Resource: ${resourcePattern} · Risk: ${risk} · Expires in ${minutes} minutes.</p>
           <p style="color:#8b8b8b;font-size:13px">Reason: ${opts.reason}</p>
           <p style="margin:24px 0"><a href="${link}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Review and decide</a></p>
           <p style="color:#8b8b8b;font-size:12px">Approving activates the grant for ${durationMinutes} minutes. Authab never puts credentials in email.</p>`,
        ),
        text: `${summary}\nActions: ${actions.join(", ")}\nResource: ${resourcePattern}\nRisk: ${risk}\nReason: ${opts.reason}\nExpires in ${minutes} minutes.\nReview: ${link}`,
      }).catch(() => null),
    ),
  );

  await dispatchEvent(opts.environment.id, "approval.requested", {
    approvalId: approval.id,
    kind: "grant",
    agent: opts.agent.name,
    action: "grant.request",
    risk,
    summary,
    actions,
    resourcePattern,
    durationMinutes,
    slaDueAt: slaDueAt?.toISOString() ?? null,
    approvalUrl: link,
  });

  return {
    ok: true,
    approvalId: approval.id,
    grantId: grant.id,
    approvalUrl: link,
    expiresAt: approval.expiresAt.toISOString(),
  };
}
