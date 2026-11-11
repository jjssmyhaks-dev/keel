import type { Agent, Credential, Environment } from "@prisma/client";
import { db } from "./db";
import { randomToken } from "./crypto";
import { actionFor, connector } from "./connectors";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { notifyApprovers, notify } from "./notifications";
import { envSettings } from "./policy";
import { executeAction, redact } from "./proxy";
import { emailLayout, sendEmail } from "./email";
import { checkPlanLimit, productionAccess } from "./limits";
import { approvalUrlFor } from "./signed-links";

export async function createApprovalRequest(opts: {
  environment: Environment;
  agent: Agent;
  credential: Credential;
  grantId: string | null;
  actionName: string;
  risk: string;
  input: Record<string, unknown>;
  resource?: string;
  requestId: string;
  reason: string;
}) {
  const connectorDef = connector(opts.credential.connectorSlug);
  const action = actionFor(opts.credential.connectorSlug, opts.actionName);
  const settings = envSettings(opts.environment);
  const minutes = settings.approvalExpiryMinutes ?? 60;
  const token = `apr_${randomToken(24)}`;
  const project = await db.project.findUnique({
    where: { id: opts.environment.projectId },
    select: { orgId: true },
  });
  const orgId = project?.orgId ?? "";

  const summary = `${opts.agent.name} wants to ${(action?.label ?? opts.actionName).toLowerCase()} on ${
    connectorDef?.name ?? opts.credential.connectorSlug
  }${opts.resource ? ` · ${opts.resource}` : ""}.`;

  const approval = await db.approvalRequest.create({
    data: {
      environmentId: opts.environment.id,
      agentId: opts.agent.id,
      grantId: opts.grantId,
      credentialId: opts.credential.id,
      action: opts.actionName,
      summary,
      payloadJson: JSON.stringify({
        input: opts.input,
        resource: opts.resource ?? null,
        requestId: opts.requestId,
        connector: opts.credential.connectorSlug,
      }),
      redactedJson: JSON.stringify(redact(opts.input, connectorDef?.redactedFields ?? [])),
      risk: opts.risk,
      token,
      requestId: opts.requestId,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    },
  });

  await auditEvent({
    environmentId: opts.environment.id,
    actorType: "agent",
    actorId: opts.agent.id,
    actorName: opts.agent.name,
    agentId: opts.agent.id,
    action: "approval.requested",
    resourceType: "approval",
    resourceId: approval.id,
    outcome: "recorded",
    requestId: opts.requestId,
    payloadSummary: {
      action: opts.actionName,
      resource: opts.resource,
      risk: opts.risk,
      reason: opts.reason,
      summary,
    },
  });

  await notifyApprovers({
    orgId,
    title: "Approval needed",
    body: summary,
    href: `/app/approvals/${approval.id}`,
  });

  const approvers = await db.membership.findMany({
    where: { orgId, role: { in: ["owner", "admin", "approver"] } },
    include: { user: true },
  });
  const link = approvalUrlFor(token);
  const minutesLeft = minutes;
  await Promise.all(
    approvers.map((member) =>
      sendEmail({
        to: member.user.email,
        subject: `Approval needed: ${connectorDef?.name ?? opts.credential.connectorSlug}`,
        html: emailLayout(
          "A human decision is needed",
          `<p>${summary}</p>
           <p style="color:#8b8b8b;font-size:13px">Risk: ${opts.risk} · Environment: ${opts.environment.type} · Expires in ${minutesLeft} minutes.</p>
           <p style="margin:24px 0"><a href="${link}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Review and decide</a></p>
           <p style="color:#8b8b8b;font-size:12px">Authab never puts credentials in email. Open the request to see the redacted payload.</p>`,
        ),
        text: `${summary}\nRisk: ${opts.risk}\nExpires in ${minutesLeft} minutes.\nReview: ${link}`,
      }).catch(() => null),
    ),
  );

  await dispatchEvent(opts.environment.id, "approval.requested", {
    approvalId: approval.id,
    agent: opts.agent.name,
    action: opts.actionName,
    resource: opts.resource,
    risk: opts.risk,
    summary,
    approvalUrl: link,
  });

  return approval;
}

export async function decideApproval(opts: {
  approvalId: string;
  decision: "approve" | "deny";
  note?: string;
  userId: string;
  userName: string;
  approveAlways?: boolean;
  ip?: string | null;
}): Promise<{ ok: true; status: string; result?: unknown } | { ok: false; error: string }> {
  const approval = await db.approvalRequest.findUnique({
    where: { id: opts.approvalId },
    include: {
      agent: true,
      credential: true,
      grant: true,
      environment: { include: { project: true } },
    },
  });
  if (!approval) return { ok: false, error: "Approval not found." };
  if (approval.status !== "pending") return { ok: false, error: `This request is already ${approval.status}.` };
  if (approval.expiresAt < new Date()) {
    await db.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "expired", decidedAt: new Date(), decisionNote: "Expired before a decision." },
    });
    return { ok: false, error: "This request has expired." };
  }

  if (opts.decision === "deny") {
    await db.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: "denied",
        decidedAt: new Date(),
        decidedBy: opts.userId,
        decisionNote: opts.note || "Denied.",
      },
    });
    await auditEvent({
      environmentId: approval.environmentId,
      actorType: "human",
      actorId: opts.userId,
      actorName: opts.userName,
      agentId: approval.agentId,
      action: "approval.decided",
      resourceType: "approval",
      resourceId: approval.id,
      outcome: "denied",
      ip: opts.ip,
      payloadSummary: { decision: "deny", note: opts.note ?? null, action: approval.action },
    });
    await dispatchEvent(approval.environmentId, "approval.decided", {
      approvalId: approval.id,
      decision: "deny",
      decidedBy: opts.userName,
      note: opts.note ?? null,
    });
    return { ok: true, status: "denied" };
  }

  const payload = JSON.parse(approval.payloadJson || "{}") as {
    input?: Record<string, unknown>;
    resource?: string | null;
  };
  const action = actionFor(approval.credential?.connectorSlug ?? "", approval.action);

  let result: unknown = null;
  let status = "approved";
  if (action && approval.credential) {
    if (approval.credential.revokedAt || approval.credential.status === "revoked") {
      status = "failed";
      result = { error: "The connection was revoked before this approval was executed." };
    } else if (approval.credential.status === "broken") {
      status = "failed";
      result = {
        error:
          approval.credential.healthDetail ??
          "The provider rejected this credential. Rotate it in the vault before executing.",
      };
    } else if (approval.credential.expiresAt && approval.credential.expiresAt < new Date()) {
      status = "failed";
      result = { error: "The connection expired before this approval was executed. Rotate it in the vault." };
    } else if (approval.grant?.expiresAt && approval.grant.expiresAt < new Date()) {
      status = "failed";
      result = { error: "The grant expired before this approval was executed. Request a new grant." };
    } else {
      const org = await db.organization.findUnique({
        where: { id: approval.environment.project.orgId },
        select: { plan: true, planStatus: true },
      });
      const plan = org?.plan ?? "free";
      const planStatus = org?.planStatus ?? "active";
      const access = productionAccess(plan, planStatus);
      if (approval.environment.type === "production" && !access.allowed) {
        status = "failed";
        result = { error: access.message };
      } else {
        const quota = await checkPlanLimit(approval.environment.project.orgId, "calls", plan, planStatus);
        if (!quota.allowed) {
          status = "failed";
          result = { error: quota.message };
        } else {
          try {
            result = await executeAction({
              environment: approval.environment,
              agent: approval.agent,
              credential: approval.credential,
              action,
              input: payload.input ?? {},
              resource: payload.resource ?? undefined,
              requestId: approval.requestId,
              ip: opts.ip,
              approvalId: approval.id,
            });
          } catch (error) {
            status = "failed";
            result = { error: error instanceof Error ? error.message : "Execution failed." };
          }
        }
      }
    }
  }

  await db.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status,
      decidedAt: new Date(),
      decidedBy: opts.userId,
      decisionNote: opts.note || "Approved.",
      executionResult: JSON.stringify(result),
    },
  });

  if (opts.approveAlways && approval.grant) {
    await db.grant.update({ where: { id: approval.grant.id }, data: { approvalMode: "allow" } });
  }

  await auditEvent({
    environmentId: approval.environmentId,
    actorType: "human",
    actorId: opts.userId,
    actorName: opts.userName,
    agentId: approval.agentId,
    action: "approval.decided",
    resourceType: "approval",
    resourceId: approval.id,
    outcome: status === "failed" ? "error" : "approved",
    ip: opts.ip,
    payloadSummary: {
      decision: "approve",
      note: opts.note ?? null,
      action: approval.action,
      approveAlways: Boolean(opts.approveAlways),
      executionStatus: status,
    },
  });

  await dispatchEvent(approval.environmentId, "approval.decided", {
    approvalId: approval.id,
    decision: "approve",
    decidedBy: opts.userName,
    note: opts.note ?? null,
    executionStatus: status,
  });

  if (approval.agent.ownerUserId) {
    await notify({
      orgId: approval.environment.project.orgId,
      userId: approval.agent.ownerUserId,
      type: "approval",
      title: `Approved: ${approval.summary}`,
      body: opts.note || "The request was approved and executed.",
      href: `/app/approvals/${approval.id}`,
    });
  }

  return { ok: true, status, result };
}

export async function expireStaleApprovals(environmentId?: string) {
  await db.approvalRequest.updateMany({
    where: {
      ...(environmentId ? { environmentId } : {}),
      status: "pending",
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired", decidedAt: new Date(), decisionNote: "Expired before a decision." },
  });
}
