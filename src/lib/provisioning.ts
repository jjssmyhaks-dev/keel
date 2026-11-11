import { db } from "./db";
import { auditEvent } from "./audit";
import { slugify } from "./format";

const DEFAULT_SETTINGS = {
  autoApproveDev: true,
  approvalExpiryMinutes: 60,
  defaultOutcome: "deny",
  agentRateLimitPerMinute: 120,
  sessionHours: 720,
  escalateAfterMinutes: 30,
  allowedDomains: "",
  ipAllowlist: "",
};

export async function provisionOrganization(opts: {
  userId: string;
  userName: string;
  orgName: string;
  plan?: string;
  ip?: string | null;
}) {
  let slug = slugify(opts.orgName) || `org-${Date.now().toString(36)}`;
  let counter = 1;
  while (await db.organization.findUnique({ where: { slug } })) {
    slug = `${slugify(opts.orgName)}-${counter++}`;
  }

  const org = await db.organization.create({
    data: {
      name: opts.orgName,
      slug,
      plan: opts.plan ?? "free",
      billingCurrency: "USD",
      billingEmail: null,
      memberships: { create: { userId: opts.userId, role: "owner" } },
    },
  });

  const project = await db.project.create({
    data: {
      orgId: org.id,
      name: "Default project",
      environments: {
        create: [
          { type: "development", settingsJson: JSON.stringify(DEFAULT_SETTINGS) },
          { type: "production", settingsJson: JSON.stringify(DEFAULT_SETTINGS) },
        ],
      },
    },
    include: { environments: true },
  });

  const dev = project.environments.find((e) => e.type === "development")!;
  const prod = project.environments.find((e) => e.type === "production")!;

  await auditEvent({
    environmentId: dev.id,
    actorType: "human",
    actorId: opts.userId,
    actorName: opts.userName,
    action: "settings.updated",
    resourceType: "organization",
    resourceId: org.id,
    outcome: "recorded",
    ip: opts.ip,
    payloadSummary: { event: "organization.created", name: org.name, plan: org.plan },
  });

  return {
    org,
    project,
    development: dev,
    production: prod,
  };
}

export async function completeOnboarding(userId: string) {
  await db.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } });
}

export async function findDemoUser() {
  return db.user.findUnique({ where: { email: "demo@authab.dev" } });
}
