import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "authab_session";
export const ORG_COOKIE = "authab_org";
export const PROJECT_COOKIE = "authab_project";
export const ENV_COOKIE = "authab_env";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

export const ROLES = ["owner", "admin", "developer", "approver", "viewer"] as const;
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
  view: ["owner", "admin", "developer", "approver", "viewer"],
  manage_agents: ["owner", "admin", "developer"],
  manage_credentials: ["owner", "admin", "developer"],
  manage_grants: ["owner", "admin", "developer"],
  approve: ["owner", "admin", "approver"],
  manage_team: ["owner", "admin"],
  manage_billing: ["owner"],
  delete_org: ["owner"],
  manage_security: ["owner", "admin"],
  write_production: ["owner", "admin"],
  kill_switch: ["owner", "admin", "developer"],
};

export function can(role: string | undefined, capability: Capability) {
  if (!role) return false;
  return CAPABILITIES[capability]?.includes(role as Role) ?? false;
}

export async function createSession(userId: string, meta?: { device?: string; ip?: string; userAgent?: string }) {
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
    where: { userId: user.id },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });
  if (!memberships.length) {
    return redirect("/onboarding?step=organization");
  }

  const requestedOrg = store.get(ORG_COOKIE)?.value;
  const membership = memberships.find((m) => m.orgId === requestedOrg) ?? memberships[0];
  const org = membership.org;

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

  return {
    user,
    session,
    memberships,
    org,
    role: membership.role as Role,
    membership,
    projects,
    project,
    environments,
    environment,
    organizationId: org.id,
    environmentType: environment?.type ?? "development",
    isProduction: production,
    plan,
    capabilities: {
      manageAgents: can(membership.role, "manage_agents") && (!production || can(membership.role, "write_production")),
      manageCredentials: can(membership.role, "manage_credentials") && (!production || can(membership.role, "write_production")),
      manageGrants: can(membership.role, "manage_grants") && (!production || can(membership.role, "write_production")),
      approve: can(membership.role, "approve"),
      manageTeam: can(membership.role, "manage_team"),
      manageBilling: can(membership.role, "manage_billing"),
      manageSecurity: can(membership.role, "manage_security"),
      killSwitch: can(membership.role, "kill_switch"),
      writeProduction: can(membership.role, "write_production"),
    },
  };
}

export const getContext = cache(getContextInner);

export async function requireCapability(capability: Capability) {
  const ctx = await getContext();
  if (!can(ctx.role, capability)) throw new Error("You do not have permission to do that.");
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
