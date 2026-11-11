import { db } from "@/lib/db";
import { appUrl } from "@/lib/email";
import {
  authenticateScim,
  membershipWhereForFilter,
  parseScimFilter,
  provisionScimUser,
  scimError,
  scimJson,
  serializeScimUser,
  SCIM_LIST_SCHEMA,
} from "@/lib/scim";

export const dynamic = "force-dynamic";

const BASE = appUrl("/api/scim/v2");

export async function GET(req: Request) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (filter === "invalid") return scimError(400, "Unsupported filter. Use userName, externalId or active eq.", "invalidFilter");

  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? 1) || 1);
  const count = Math.min(200, Math.max(0, Number(url.searchParams.get("count") ?? 100) || 100));
  const where = membershipWhereForFilter(auth.orgId, filter);

  const [total, memberships] = await Promise.all([
    db.membership.count({ where }),
    db.membership.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count,
    }),
  ]);

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: memberships.length,
    Resources: memberships.map((membership) => serializeScimUser(membership, BASE)),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, "The request body must be JSON.", "invalidSyntax");
  }

  const result = await provisionScimUser(auth, body);
  if (!result.membership) {
    return scimJson(result.body, result.status);
  }
  const resource = serializeScimUser(result.membership, BASE);
  return scimJson(resource, 201, { location: `${BASE}/Users/${result.membership.id}` });
}
