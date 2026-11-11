import { Prisma } from "@prisma/client";
import { db } from "./db";
import { sha256 } from "./crypto";
import { checkPlanLimit } from "./limits";
import { auditEvent } from "./audit";
import { ROLES, type Role } from "./session";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const ASSIGNABLE = ROLES.filter((role): role is Exclude<Role, "owner"> => role !== "owner");

export function scimJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/scim+json", ...headers },
  });
}

export function scimError(status: number, detail: string, scimType?: string) {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      detail,
      status: String(status),
      ...(scimType ? { scimType } : {}),
    },
    status,
  );
}

export type ScimAuth = {
  tokenId: string;
  tokenName: string;
  orgId: string;
  orgName: string;
  plan: string;
  planStatus: string;
};

export async function authenticateScim(req: Request): Promise<ScimAuth | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("scim_")) {
    return scimError(401, "A SCIM bearer token is required.", "unauthenticated");
  }
  const record = await db.scimToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      org: { select: { id: true, name: true, deletedAt: true, plan: true, planStatus: true } },
    },
  });
  if (!record || record.revokedAt || record.org.deletedAt) {
    return new Response(
      JSON.stringify({ schemas: [SCIM_ERROR_SCHEMA], detail: "Invalid SCIM token.", status: "401" }),
      {
        status: 401,
        headers: {
          "content-type": "application/scim+json",
          "www-authenticate": 'Bearer realm="authab", error="invalid_token"',
        },
      },
    );
  }
  await db.scimToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);
  return {
    tokenId: record.id,
    tokenName: record.name,
    orgId: record.org.id,
    orgName: record.org.name,
    plan: record.org.plan,
    planStatus: record.org.planStatus,
  };
}

export function scimRoleFromBody(body: Record<string, unknown>, fallback: Role = "developer"): Role | null {
  const raw = body.roles;
  const values = Array.isArray(raw)
    ? raw
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : entry && typeof entry === "object" && typeof (entry as { value?: unknown }).value === "string"
              ? String((entry as { value: string }).value)
              : "",
        )
        .filter(Boolean)
    : [];
  for (const value of values) {
    const normalized = value.toLowerCase().trim();
    if (normalized === "owner") return null;
    if (ASSIGNABLE.includes(normalized as Exclude<Role, "owner">)) return normalized as Role;
  }
  return fallback;
}

type MembershipWithUser = {
  id: string;
  role: string;
  status: string;
  scimExternalId: string | null;
  createdAt: Date;
  user: { id: string; email: string; name: string; emailVerifiedAt: Date | null };
};

export function serializeScimUser(membership: MembershipWithUser, baseUrl: string) {
  const [givenName, ...rest] = membership.user.name.split(" ");
  const familyName = rest.join(" ");
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: membership.id,
    externalId: membership.scimExternalId ?? undefined,
    userName: membership.user.email,
    name: {
      formatted: membership.user.name,
      givenName,
      familyName: familyName || undefined,
    },
    displayName: membership.user.name,
    active: membership.status === "active",
    emails: [{ value: membership.user.email, primary: true, type: "work" }],
    roles: [{ value: membership.role, primary: true }],
    meta: {
      resourceType: "User",
      created: membership.createdAt.toISOString(),
      lastModified: membership.createdAt.toISOString(),
      location: `${baseUrl}/Users/${membership.id}`,
    },
  };
}

export type ScimFilter =
  | { kind: "userName"; value: string }
  | { kind: "externalId"; value: string }
  | { kind: "active"; value: boolean }
  | null;

export function parseScimFilter(raw: string | null): ScimFilter | "invalid" {
  if (!raw) return null;
  const match = raw.match(/^\s*(userName|externalId|active)\s+eq\s+"?([^"]+)"?\s*$/i);
  if (!match) return "invalid";
  const attribute = match[1].toLowerCase();
  const value = match[2];
  if (attribute === "active") {
    if (!["true", "false"].includes(value.toLowerCase())) return "invalid";
    return { kind: "active", value: value.toLowerCase() === "true" };
  }
  if (attribute === "username") return { kind: "userName", value: value.toLowerCase() };
  return { kind: "externalId", value };
}

export function membershipWhereForFilter(
  orgId: string,
  filter: ScimFilter,
): Prisma.MembershipWhereInput {
  if (!filter) return { orgId };
  if (filter.kind === "userName") {
    return { orgId, user: { email: { equals: filter.value, mode: "insensitive" } } };
  }
  if (filter.kind === "externalId") {
    return { orgId, scimExternalId: filter.value };
  }
  return { orgId, status: filter.value ? "active" : "suspended" };
}

export async function findScimMembership(orgId: string, id: string) {
  const membership = await db.membership.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!membership || membership.orgId !== orgId) return null;
  return membership;
}

export async function scimAudit(
  auth: ScimAuth,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
) {
  const environment = await db.environment.findFirst({
    where: { project: { orgId: auth.orgId }, type: "development" },
    select: { id: true },
  });
  if (!environment) return;
  await auditEvent({
    environmentId: environment.id,
    actorType: "system",
    actorId: auth.tokenId,
    actorName: `SCIM · ${auth.tokenName}`,
    action,
    resourceType: "membership",
    resourceId,
    outcome: "recorded",
    payloadSummary: { ...payload, orgId: auth.orgId },
  });
}

export async function provisionScimUser(
  auth: ScimAuth,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; membership?: MembershipWithUser }> {
  const userName = String(body.userName ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userName)) {
    return { status: 400, body: { schemas: [SCIM_ERROR_SCHEMA], detail: "userName must be an email address.", status: "400", scimType: "invalidValue" } };
  }
  const role = scimRoleFromBody(body);
  if (!role) {
    return { status: 400, body: { schemas: [SCIM_ERROR_SCHEMA], detail: "The owner role cannot be provisioned through SCIM.", status: "400", scimType: "invalidValue" } };
  }
  const active = body.active !== false;
  const externalId = body.externalId ? String(body.externalId).slice(0, 200) : null;
  const name =
    (typeof body.displayName === "string" && body.displayName.trim()) ||
    (body.name && typeof body.name === "object" && typeof (body.name as { formatted?: unknown }).formatted === "string"
      ? String((body.name as { formatted: string }).formatted).trim()
      : "") ||
    userName.split("@")[0];

  let user = await db.user.findUnique({ where: { email: userName } });
  const existingMembership = user
    ? await db.membership.findUnique({ where: { orgId_userId: { orgId: auth.orgId, userId: user.id } } })
    : null;
  if (existingMembership) {
    return { status: 409, body: { schemas: [SCIM_ERROR_SCHEMA], detail: "This user is already a member of the organization.", status: "409", scimType: "uniqueness" } };
  }

  const quota = await checkPlanLimit(auth.orgId, "members", auth.plan, auth.planStatus);
  if (!quota.allowed) {
    return { status: 403, body: { schemas: [SCIM_ERROR_SCHEMA], detail: "The organization has reached its member limit.", status: "403" } };
  }

  if (!user) {
    user = await db.user.create({
      data: {
        id: crypto.randomUUID(),
        email: userName,
        name,
        emailVerifiedAt: new Date(),
        onboardedAt: new Date(),
      },
    });
  } else if (user.deletedAt) {
    return { status: 409, body: { schemas: [SCIM_ERROR_SCHEMA], detail: "This account is scheduled for deletion.", status: "409", scimType: "uniqueness" } };
  }

  const membership = await db.membership.create({
    data: {
      orgId: auth.orgId,
      userId: user.id,
      role,
      status: active ? "active" : "suspended",
      deactivatedAt: active ? null : new Date(),
      scimExternalId: externalId,
    },
    include: { user: true },
  });
  await scimAudit(auth, "scim.user_created", membership.id, { email: userName, role, active, externalId });
  return { status: 201, body: null, membership };
}

export async function applyScimUserPatch(
  auth: ScimAuth,
  membershipId: string,
  operations: { op?: unknown; path?: unknown; value?: unknown }[],
): Promise<{ status: number; detail?: string; scimType?: string }> {
  const membership = await findScimMembership(auth.orgId, membershipId);
  if (!membership) return { status: 404, detail: "User not found." };
  if (membership.role === "owner") {
    return { status: 409, detail: "Owner memberships are managed in Authab, not through SCIM." };
  }

  let status = membership.status;
  let role = membership.role as Role;
  let name = membership.user.name;
  let email = membership.user.email;
  let externalId = membership.scimExternalId;

  for (const operation of operations) {
    const op = String(operation.op ?? "").toLowerCase();
    if (!["add", "replace", "remove"].includes(op)) {
      return { status: 400, detail: `Unsupported patch operation: ${op || "missing"}.`, scimType: "invalidSyntax" };
    }
    const rawPath = typeof operation.path === "string" ? operation.path : "";
    const path = rawPath.toLowerCase();
    const value = operation.value;

    const assign = (path === "" && value && typeof value === "object" ? (value as Record<string, unknown>) : null) ?? null;

    if (path === "active" || (!path && assign && "active" in assign)) {
      const next = path ? value : assign?.active;
      if (typeof next !== "boolean") return { status: 400, detail: "active must be a boolean.", scimType: "invalidValue" };
      status = next ? "active" : "suspended";
    } else if (path === "roles" || (!path && assign && "roles" in assign)) {
      const roleValue = scimRoleFromBody({ roles: path ? value : assign?.roles });
      if (!roleValue) return { status: 400, detail: "The owner role cannot be assigned through SCIM.", scimType: "invalidValue" };
      role = roleValue;
    } else if (path === "username" || (!path && assign && "userName" in assign)) {
      const next = String((path ? value : assign?.userName) ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) return { status: 400, detail: "userName must be an email address.", scimType: "invalidValue" };
      email = next;
    } else if (path === "externalid" || (!path && assign && "externalId" in assign)) {
      externalId = String((path ? value : assign?.externalId) ?? "").slice(0, 200) || null;
    } else if (path === "name.givenname" || path === "name.familyname" || path === "name.formatted" || path === "displayname") {
      const next = String(value ?? "").trim();
      if (path === "name.givenname") {
        const family = membership.user.name.split(" ").slice(1).join(" ");
        name = `${next}${family ? ` ${family}` : ""}`.trim() || name;
      } else if (path === "name.familyname") {
        const given = membership.user.name.split(" ")[0] ?? "";
        name = `${given} ${next}`.trim() || name;
      } else {
        name = next || name;
      }
    } else if (path === "" && assign) {
      continue;
    } else {
      return { status: 400, detail: `Unsupported patch path: ${rawPath}.`, scimType: "invalidPath" };
    }
  }

  if (email !== membership.user.email) {
    const clash = await db.user.findUnique({ where: { email } });
    if (clash && clash.id !== membership.user.id) {
      return { status: 409, detail: "Another account already uses that email.", scimType: "uniqueness" };
    }
    await db.user.update({ where: { id: membership.user.id }, data: { email } });
  }
  if (name !== membership.user.name) {
    await db.user.update({ where: { id: membership.user.id }, data: { name } });
  }

  const nextStatus = status === "active" ? "active" : status;
  if (nextStatus !== membership.status) {
    await db.membership.update({
      where: { id: membership.id },
      data: { status: nextStatus, deactivatedAt: nextStatus === "active" ? null : new Date() },
    });
    if (nextStatus !== "active") {
      await db.session.updateMany({
        where: { userId: membership.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  if (role !== membership.role) {
    await db.membership.update({ where: { id: membership.id }, data: { role } });
  }
  if (externalId !== membership.scimExternalId) {
    await db.membership.update({ where: { id: membership.id }, data: { scimExternalId: externalId } });
  }

  await scimAudit(auth, nextStatus === "active" ? "scim.user_updated" : "scim.user_deactivated", membership.id, {
    email,
    role,
    active: nextStatus === "active",
  });
  return { status: 200 };
}

export async function deactivateScimUser(auth: ScimAuth, membershipId: string) {
  const membership = await findScimMembership(auth.orgId, membershipId);
  if (!membership) return { status: 404 as const };
  if (membership.role === "owner") return { status: 409 as const };
  await db.$transaction([
    db.membership.update({
      where: { id: membership.id },
      data: { status: "suspended", deactivatedAt: new Date() },
    }),
    db.session.updateMany({
      where: { userId: membership.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await scimAudit(auth, "scim.user_deactivated", membership.id, {
    email: membership.user.email,
    reason: "deprovisioned",
  });
  return { status: 204 as const };
}
