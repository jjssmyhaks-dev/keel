import { db } from "./db";
import { generateAgentIdentity } from "./crypto";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { notify } from "./notifications";
import { checkPlanLimit } from "./limits";

type Readiness = { level: "pass" | "warn" | "fail"; label: string; detail: string }[];

export async function previewPromotion(devAgentId: string) {
  const dev = await db.agent.findUnique({
    where: { id: devAgentId },
    include: {
      environment: { include: { project: { include: { org: true, environments: true } } } },
      grants: { include: { credential: true } },
    },
  });
  if (!dev) return { ok: false as const, error: "Agent not found." };
  if (dev.environment.type !== "development") return { ok: false as const, error: "Only development agents can be promoted." };
  if (dev.status === "revoked") return { ok: false as const, error: "Revoked agents cannot be promoted." };

  const org = dev.environment.project.org;
  const planOk = ["pro", "scale", "enterprise"].includes(org.plan);
  const prodEnv = dev.environment.project.environments.find((e) => e.type === "production");
  if (!prodEnv) return { ok: false as const, error: "This project has no production environment." };

  const existing = await db.agent.findFirst({
    where: { environmentId: prodEnv.id, promotedFromAgentId: dev.id },
  });

  const prodCredentials = await db.credential.findMany({
    where: { environmentId: prodEnv.id, revokedAt: null },
  });

  const readiness: Readiness = [];
  readiness.push(
    dev.description
      ? { level: "pass", label: "Agent described", detail: "Production reviewers know what this agent does." }
      : { level: "warn", label: "No description", detail: "Add a description so approvers understand the agent." },
  );
  readiness.push(
    dev.ownerUserId
      ? { level: "pass", label: "Owner assigned", detail: "A named member is accountable in production." }
      : { level: "warn", label: "No owner", detail: "Assign an owner before production traffic starts." },
  );
  readiness.push(
    planOk
      ? { level: "pass", label: "Plan allows promotion", detail: `${org.plan} includes production environments.` }
      : { level: "fail", label: "Paid plan required", detail: "Promotion requires Pro or higher." },
  );
  readiness.push(
    existing
      ? { level: "warn", label: "Already in production", detail: `This agent is live as ${existing.name}.` }
      : { level: "pass", label: "First promotion", detail: "A new production identity will be created." },
  );

  const writeWithoutApproval = dev.grants.filter((g) => {
    const actions = JSON.parse(g.actionsJson || "[]") as string[];
    return actions.some((a) => !a.endsWith(".list") && !a.includes("read")) && !g.approvalMode;
  });
  readiness.push(
    writeWithoutApproval.length === 0
      ? { level: "pass", label: "Approval rules set", detail: "Writes have an explicit approval mode." }
      : {
          level: "warn",
          label: `${writeWithoutApproval.length} grant(s) without approval mode`,
          detail: "Safe launch will require approval for non-read calls for the first 7 days.",
        },
  );

  const missing = dev.grants.filter(
    (g) => !prodCredentials.some((c) => c.connectorSlug === g.credential.connectorSlug),
  );
  if (missing.length) {
    readiness.push({
      level: "warn",
      label: `${missing.length} connection(s) missing in production`,
      detail: `Add production credentials for ${[...new Set(missing.map((m) => m.credential.connectorSlug))].join(", ")} before granting access.`,
    });
  } else {
    readiness.push({
      level: "pass",
      label: "Production connections available",
      detail: "Every development connector has a production counterpart.",
    });
  }

  const diff = dev.grants.map((grant) => {
    const matched = prodCredentials.find((c) => c.connectorSlug === grant.credential.connectorSlug);
    return {
      connector: grant.credential.connectorSlug,
      credentialName: grant.credential.name,
      productionCredentialName: matched?.name ?? null,
      granted: Boolean(matched),
      actions: JSON.parse(grant.actionsJson || "[]") as string[],
      resourcePattern: grant.resourcePattern,
      approvalMode: grant.approvalMode,
    };
  });

  return {
    ok: true as const,
    agent: dev,
    orgPlan: org.plan,
    planOk,
    prodEnv,
    existing,
    readiness,
    diff,
  };
}

export async function promoteAgent(opts: {
  devAgentId: string;
  userId: string;
  userName: string;
  userEmailVerified: boolean;
  ip?: string | null;
}) {
  const dev = await db.agent.findUnique({
    where: { id: opts.devAgentId },
    include: {
      environment: { include: { project: { include: { org: true, environments: true } } } },
      grants: { include: { credential: true } },
      approvalPolicies: true,
    },
  });
  if (!dev) return { ok: false as const, error: "Agent not found." };
  if (dev.environment.type !== "development") return { ok: false as const, error: "Only development agents can be promoted." };
  if (dev.status === "revoked") return { ok: false as const, error: "Revoked agents cannot be promoted." };

  const org = dev.environment.project.org;
  if (!["pro", "scale", "enterprise"].includes(org.plan)) {
    return { ok: false as const, error: "Promotion requires the Pro plan or higher." };
  }
  if (!opts.userEmailVerified) return { ok: false as const, error: "Verify your email address before promoting to production." };

  const quota = await checkPlanLimit(org.id, "agents", org.plan);
  if (!quota.allowed) return { ok: false as const, error: quota.message };

  const prodEnv = dev.environment.project.environments.find((e) => e.type === "production");
  if (!prodEnv) return { ok: false as const, error: "This project has no production environment." };

  const existing = await db.agent.findFirst({
    where: { environmentId: prodEnv.id, promotedFromAgentId: dev.id },
  });
  if (existing) return { ok: false as const, error: `This agent is already in production as ${existing.name}.` };

  const prodCredentials = await db.credential.findMany({
    where: { environmentId: prodEnv.id, revokedAt: null },
  });

  const readiness: Readiness = [];
  readiness.push(
    dev.description
      ? { level: "pass", label: "Agent described", detail: "Production reviewers know what this agent does." }
      : { level: "warn", label: "No description", detail: "Add a description so approvers understand the agent." },
  );
  readiness.push(
    dev.ownerUserId
      ? { level: "pass", label: "Owner assigned", detail: "A named member is accountable in production." }
      : { level: "warn", label: "No owner", detail: "Assign an owner before production traffic starts." },
  );
  readiness.push(
    opts.userEmailVerified
      ? { level: "pass", label: "Email verified", detail: "The promoting account is verified." }
      : { level: "fail", label: "Email unverified", detail: "Verify your email before promoting." },
  );

  const writeWithoutApproval = dev.grants.filter((g) => {
    const actions = JSON.parse(g.actionsJson || "[]") as string[];
    return actions.some((a) => !a.endsWith(".list") && !a.includes("read")) && !g.approvalMode;
  });
  readiness.push(
    writeWithoutApproval.length === 0
      ? { level: "pass", label: "Approval rules set", detail: "Writes have an explicit approval mode." }
      : {
          level: "warn",
          label: `${writeWithoutApproval.length} grant(s) without approval mode`,
          detail: "Safe launch will require approval for non-read calls for the first 7 days.",
        },
  );

  const missing = dev.grants.filter(
    (g) => !prodCredentials.some((c) => c.connectorSlug === g.credential.connectorSlug),
  );
  if (missing.length) {
    readiness.push({
      level: "warn",
      label: `${missing.length} connection(s) missing in production`,
      detail: `Add production credentials for ${[...new Set(missing.map((m) => m.credential.connectorSlug))].join(", ")} before granting access.`,
    });
  } else {
    readiness.push({
      level: "pass",
      label: "Production connections available",
      detail: "Every development connector has a production counterpart.",
    });
  }

  const identity = generateAgentIdentity();
  const safeLaunchUntil = new Date(Date.now() + 7 * 86400_000);

  let name = dev.name;
  if (await db.agent.findFirst({ where: { environmentId: prodEnv.id, name } })) {
    name = `${dev.name}-prod`;
  }

  const prodAgent = await db.agent.create({
    data: {
      environmentId: prodEnv.id,
      name,
      description: dev.description,
      ownerUserId: dev.ownerUserId,
      publicKey: identity.publicKey,
      fingerprint: identity.fingerprint,
      keyMode: "client",
      tagsJson: dev.tagsJson,
      framework: dev.framework,
      safeLaunchUntil,
      promotedFromAgentId: dev.id,
      keys: { create: { publicKey: identity.publicKey } },
    },
  });

  const copied: { connector: string; granted: boolean; actions: string[] }[] = [];
  for (const grant of dev.grants) {
    const prodCredential = prodCredentials.find((c) => c.connectorSlug === grant.credential.connectorSlug);
    const actions = JSON.parse(grant.actionsJson || "[]") as string[];
    if (!prodCredential) {
      copied.push({ connector: grant.credential.connectorSlug, granted: false, actions });
      continue;
    }
    await db.grant.create({
      data: {
        environmentId: prodEnv.id,
        agentId: prodAgent.id,
        credentialId: prodCredential.id,
        actionsJson: grant.actionsJson,
        resourcePattern: grant.resourcePattern,
        conditionsJson: grant.conditionsJson,
        approvalMode: grant.approvalMode ?? "require_approval",
        purpose: grant.purpose,
        createdBy: opts.userId,
        expiresAt: grant.expiresAt,
      },
    });
    copied.push({ connector: grant.credential.connectorSlug, granted: true, actions });
  }

  if (dev.approvalPolicies.length) {
    await db.approvalPolicy.createMany({
      data: dev.approvalPolicies.map((p) => ({
        environmentId: prodEnv.id,
        agentId: prodAgent.id,
        actionPattern: p.actionPattern,
        mode: p.mode,
      })),
    });
  }

  const promotion = await db.promotion.create({
    data: {
      devAgentId: dev.id,
      prodAgentId: prodAgent.id,
      orgId: org.id,
      diffJson: JSON.stringify({
        from: dev.environmentId,
        to: prodEnv.id,
        name,
        tags: JSON.parse(dev.tagsJson || "[]"),
        grants: copied,
        identities: { from: dev.fingerprint, to: identity.fingerprint },
      }),
      readinessJson: JSON.stringify({ checks: readiness, safeLaunchUntil: safeLaunchUntil.toISOString() }),
      approvedBy: opts.userId,
      status: "completed",
    },
  });

  await auditEvent({
    environmentId: prodEnv.id,
    actorType: "human",
    actorId: opts.userId,
    actorName: opts.userName,
    agentId: prodAgent.id,
    action: "promotion.completed",
    resourceType: "agent",
    resourceId: prodAgent.id,
    outcome: "recorded",
    ip: opts.ip,
    payloadSummary: {
      promotionId: promotion.id,
      devAgentId: dev.id,
      newFingerprint: identity.fingerprint,
      grantsCopied: copied.filter((c) => c.granted).length,
      grantsSkipped: copied.filter((c) => !c.granted).length,
      safeLaunchUntil: safeLaunchUntil.toISOString(),
    },
  });

  await dispatchEvent(prodEnv.id, "agent.status_changed", {
    agentId: prodAgent.id,
    name,
    status: "active",
    promoted: true,
  });

  if (prodAgent.ownerUserId) {
    await notify({
      orgId: org.id,
      userId: prodAgent.ownerUserId,
      type: "system",
      title: `${name} is live in production`,
      body: "Safe launch is on for 7 days: non-read calls require approval.",
      href: `/app/agents/${prodAgent.id}`,
    });
  }

  return {
    ok: true as const,
    promotion,
    agent: prodAgent,
    identity,
    readiness,
    diff: copied,
    safeLaunchUntil,
  };
}
