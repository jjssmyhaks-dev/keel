import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { ENV_COOKIE, ORG_COOKIE, PROJECT_COOKIE, SESSION_COOKIE } from "./cookies";

export { ENV_COOKIE, ORG_COOKIE, PROJECT_COOKIE, SESSION_COOKIE };

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

export const ROLES = ["owner", "admin", "developer", "approver", "auditor", "billing", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  owner: {
    label: "Owner",
    description: "Everything, including billing, organization deletion and production.",
  },
  admin: {
    label: "Admin",
    description: "Full platform access except billing and organization deletion.",
  },
  developer: {
    label: "Developer",
    description: "Agents, credentials and the development environment. Read-only in production.",
  },
  approver: {
    label: "Approver",
    description: "Approvals inbox, activity log and read access to agents and connections.",
  },
  auditor: {
    label: "Auditor",
    description: "Read-only across agents, policy, activity and security posture. No changes, no secrets.",
  },
  billing: {
    label: "Billing",
    description: "Read the workspace and manage plan, invoices and payment details.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to everything except secrets and settings.",
  },
};

export type Capability =
  | "view"
  | "manage_agents"
  | "manage_credentials"
  | "manage_grants"
  | "approve"
  | "manage_team"
  | "manage_billing"
  | "delete_org"
  | "manage_security"
  | "write_production"
  | "kill_switch";

const CAPABILITIES: Record<Capability, Role[]> = {
  view: ["owner", "admin", "developer", "approver", "auditor", "billing", "viewer"],
  manage_agents: ["owner", "admin", "developer"],
  manage_credentials: ["owner", "admin", "developer"],
  manage_grants: ["owner", "admin", "developer"],
  approve: ["owner", "admin", "approver"],
  manage_team: ["owner", "admin"],
  manage_billing: ["owner", "billing"],
  delete_org: ["owner"],
  manage_security: ["owner", "admin"],
  write_production: ["owner", "admin"],
  kill_switch: ["owner", "admin", "developer"],
};

// Capabilities an owner/admin may hand to an individual membership beyond its
// base role. delete_org and view stay role-bound.
export const GRANTABLE_CAPABILITIES = [
  "manage_agents",
  "manage_credentials",
  "manage_grants",
  "approve",
  "manage_team",
  "manage_billing",
  "manage_security",
  "write_production",
  "kill_switch",
] as const satisfies readonly Capability[];

export type GrantableCapability = (typeof GRANTABLE_CAPABILITIES)[number];

export function can(role: string | undefined, capability: Capability) {
  if (!role) return false;
  return CAPABILITIES[capability]?.includes(role as Role) ?? false;
}

export function parseGrants(permissionsJson: string | null | undefined): GrantableCapability[] {
  if (!permissionsJson) return [];
  try {
    const parsed = JSON.parse(permissionsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((entry): entry is GrantableCapability =>
      GRANTABLE_CAPABILITIES.includes(entry as GrantableCapability),
    ))];
  } catch {
    return [];
  }
}

export function canWithGrants(
  role: string | undefined,
  grants: readonly GrantableCapability[],
  capability: Capability,
) {
  if (can(role, capability)) return true;
  return GRANTABLE_CAPABILITIES.includes(capability as GrantableCapability) && grants.includes(capability as GrantableCapability);
}

export async function createSession(
  userId: string,
  meta?: { device?: string; ip?: string; userAgent?: string },
  options?: { authMethod?: "password" | "sso" | "magic" | "oauth" | "demo"; ssoConnectionId?: string; mfaVerifiedAt?: Date | null },
) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await db.session.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      tokenHash: sha256(token),
      device: meta?.device ?? "Web browser",
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      authMethod: options?.authMethod ?? "password",
      ssoConnectionId: options?.ssoConnectionId,
      mfaVerifiedAt: options?.mfaVerifiedAt ?? null,
      expiresAt,
    },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return session;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session
      .updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } })
      .catch(() => null);
  }
  store.delete(SESSION_COOKIE);
}

export const getSession = cache(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) {
    return null;
  }
  return { session, user: session.user };
});

export async function requireUser(nextPath?: string) {
  const session = await getSession();
  if (!session) redirect(`/sign-in${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  return session;
}

export type AppContext = Awaited<ReturnType<typeof getContextInner>>;

async function getContextInner() {
  const { user, session } = await requireUser();
  const store = await cookies();

  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "active", org: { deletedAt: null } },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });
  if (!memberships.length) {
    return redirect("/onboarding?step=organization");
  }

  const requestedOrg = store.get(ORG_COOKIE)?.value;
  const membership = memberships.find((m) => m.orgId === requestedOrg) ?? memberships[0];
  const org = membership.org;

  if (org.requireSso) {
    const ssoConnection = session.ssoConnectionId
      ? await db.ssoConnection.findUnique({
          where: { id: session.ssoConnectionId },
          select: { orgId: true, enabled: true },
        })
      : null;
    const ssoValid =
      session.authMethod === "sso" && ssoConnection?.orgId === org.id && ssoConnection.enabled;
    if (!ssoValid) redirect(`/sign-in?notice=sso-required&org=${encodeURIComponent(org.slug)}`);
  }

  if (org.requireMfa && !session.mfaVerifiedAt) {
    if (!user.twoFactorEnabledAt) redirect("/mfa/enroll?required=1");
    redirect("/mfa/verify");
  }

  const projects = await db.project.findMany({
    where: { orgId: org.id, archivedAt: null },
    include: { environments: true },
    orderBy: { createdAt: "asc" },
  });
  if (!projects.length) redirect("/onboarding?step=organization");

  const requestedProject = store.get(PROJECT_COOKIE)?.value;
  const project = projects.find((p) => p.id === requestedProject) ?? projects[0];

  const requestedEnv = store.get(ENV_COOKIE)?.value;
  const environments = project.environments;
  const environment =
    environments.find((e) => e.id === requestedEnv) ??
    environments.find((e) => e.type === "development") ??
    environments[0];

  const plan = org.plan;
  const production = environment?.type === "production";
  const grants = parseGrants(membership.permissionsJson);
  const allowed = (capability: Capability) => canWithGrants(membership.role, grants, capability);

  return {
    user,
    session,
    memberships,
    org,
    role: membership.role as Role,
    membership,
    permissions: grants,
    projects,
    project,
    environments,
    environment,
    organizationId: org.id,
    environmentType: environment?.type ?? "development",
    isProduction: production,
    plan,
    can: allowed,
    capabilities: {
      manageAgents: allowed("manage_agents") && (!production || allowed("write_production")),
      manageCredentials: allowed("manage_credentials") && (!production || allowed("write_production")),
      manageGrants: allowed("manage_grants") && (!production || allowed("write_production")),
      approve: allowed("approve"),
      manageTeam: allowed("manage_team"),
      manageBilling: allowed("manage_billing"),
      manageSecurity: allowed("manage_security"),
      killSwitch: allowed("kill_switch"),
      writeProduction: allowed("write_production"),
    },
  };
}

export const getContext = cache(getContextInner);

export async function requireCapability(capability: Capability) {
  const ctx = await getContext();
  if (!ctx.can(capability)) throw new Error("You do not have permission to do that.");
  return ctx;
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") || undefined,
  };
}

export async function setActiveEnvironment(environmentId: string) {
  const store = await cookies();
  const env = await db.environment.findUnique({
    where: { id: environmentId },
    include: { project: true },
  });
  if (!env) throw new Error("Environment not found");
  store.set(ENV_COOKIE, environmentId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  store.set(PROJECT_COOKIE, env.projectId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  store.set(ORG_COOKIE, env.project.orgId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}

export async function setActiveProject(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { environments: true },
  });
  if (!project) throw new Error("Project not found");
  const env =
    project.environments.find((e) => e.type === "development") ?? project.environments[0];
  const store = await cookies();
  store.set(PROJECT_COOKIE, projectId, { path: "/", sameSite: "lax", maxAge: 31536000 });
  store.set(ORG_COOKIE, project.orgId, { path: "/", sameSite: "lax", maxAge: 31536000 });
  if (env) store.set(ENV_COOKIE, env.id, { path: "/", sameSite: "lax", maxAge: 31536000 });
}

export async function setActiveOrg(orgId: string) {
  const firstProject = await db.project.findFirst({
    where: { orgId, archivedAt: null },
    include: { environments: true },
    orderBy: { createdAt: "asc" },
  });
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { path: "/", sameSite: "lax", maxAge: 31536000 });
  store.delete(PROJECT_COOKIE);
  store.delete(ENV_COOKIE);
  if (firstProject) {
    store.set(PROJECT_COOKIE, firstProject.id, { path: "/", sameSite: "lax", maxAge: 31536000 });
    const env =
      firstProject.environments.find((e) => e.type === "development") ??
      firstProject.environments[0];
    if (env) store.set(ENV_COOKIE, env.id, { path: "/", sameSite: "lax", maxAge: 31536000 });
  }
}
