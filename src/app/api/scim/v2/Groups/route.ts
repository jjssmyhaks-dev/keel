import { authenticateScim, scimJson, SCIM_LIST_SCHEMA } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 0,
    Resources: [],
  });
}
