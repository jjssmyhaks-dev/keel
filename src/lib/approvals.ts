import type { Agent, Credential, Environment } from "@prisma/client";
import { db } from "./db";
import { randomToken } from "./crypto";
import { actionFor, connector } from "./connectors";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { notifyApprovers, notify } from "./notifications";
import { envSettings } from "./policy";
import { executeAction, redact } from "./proxy";
import { appUrl } from "./email";

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

  await dispatchEvent(opts.environment.id, "approval.requested", {
    approvalId: approval.id,
    agent: opts.agent.name,
    action: opts.actionName,
    resource: opts.resource,
    risk: opts.risk,
    summary,
    approvalUrl: appUrl(`/approve/${token}`),
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
