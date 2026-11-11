import { db } from "@/lib/db";
import { appUrl } from "@/lib/email";
import {
  applyScimUserPatch,
  authenticateScim,
  deactivateScimUser,
  findScimMembership,
  scimError,
  scimJson,
  scimAudit,
  scimRoleFromBody,
  serializeScimUser,
} from "@/lib/scim";

export const dynamic = "force-dynamic";

const BASE = appUrl("/api/scim/v2");

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const membership = await findScimMembership(auth.orgId, id);
  if (!membership) return scimError(404, "User not found.");
  return scimJson(serializeScimUser(membership, BASE));
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const membership = await findScimMembership(auth.orgId, id);
  if (!membership) return scimError(404, "User not found.");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, "The request body must be JSON.", "invalidSyntax");
  }
  const userName = String(body.userName ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userName)) {
    return scimError(400, "userName must be an email address.", "invalidValue");
  }
  if (body.roles !== undefined && !scimRoleFromBody(body)) {
    return scimError(400, "The owner role cannot be assigned through SCIM.", "invalidValue");
  }

  const operations: { op: string; path: string; value: unknown }[] = [
    { op: "replace", path: "userName", value: userName },
    { op: "replace", path: "active", value: body.active !== false },
    { op: "replace", path: "externalId", value: body.externalId ?? "" },
  ];
  if (body.roles !== undefined) {
    operations.push({ op: "replace", path: "roles", value: body.roles });
  }
  const name =
    (typeof body.displayName === "string" && body.displayName) ||
    (body.name && typeof body.name === "object" && typeof (body.name as { formatted?: unknown }).formatted === "string"
      ? String((body.name as { formatted: string }).formatted)
      : "");
  if (name) operations.push({ op: "replace", path: "name.formatted", value: name });

  const result = await applyScimUserPatch(auth, id, operations);
  if (result.status !== 200) return scimError(result.status, result.detail ?? "The update failed.", result.scimType);
  await scimAudit(auth, "scim.user_updated", id, { email: userName, active: body.active !== false });
  const updated = await findScimMembership(auth.orgId, id);
  return scimJson(updated ? serializeScimUser(updated, BASE) : {});
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;

  let body: { Operations?: unknown; operations?: unknown };
  try {
    body = (await req.json()) as { Operations?: unknown; operations?: unknown };
  } catch {
    return scimError(400, "The request body must be JSON.", "invalidSyntax");
  }
  const raw = body.Operations ?? body.operations;
  if (!Array.isArray(raw) || !raw.length) {
    return scimError(400, "PATCH requires a non-empty Operations array.", "invalidSyntax");
  }
  const operations = raw as { op?: unknown; path?: unknown; value?: unknown }[];
  const result = await applyScimUserPatch(auth, id, operations);
  if (result.status !== 200) return scimError(result.status, result.detail ?? "The update failed.", result.scimType);
  const updated = await findScimMembership(auth.orgId, id);
  return scimJson(updated ? serializeScimUser(updated, BASE) : {});
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const result = await deactivateScimUser(auth, id);
  if (result.status === 404) return scimError(404, "User not found.");
  if (result.status === 409) {
    return scimError(409, "Owner memberships are managed in Authab, not through SCIM.");
  }
  return new Response(null, { status: 204 });
}
