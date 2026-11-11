import { authenticateScim, scimJson, SCIM_USER_SCHEMA } from "@/lib/scim";

export const dynamic = "force-dynamic";

const USER_SCHEMA = {
  id: SCIM_USER_SCHEMA,
  name: "User",
  description: "Authab organization member",
  attributes: [
    { name: "userName", type: "string", multiValued: false, required: true, uniqueness: "server" },
    { name: "externalId", type: "string", multiValued: false, required: false, uniqueness: "none" },
    { name: "name", type: "complex", multiValued: false, required: false, subAttributes: [
      { name: "formatted", type: "string", multiValued: false, required: false },
      { name: "givenName", type: "string", multiValued: false, required: false },
      { name: "familyName", type: "string", multiValued: false, required: false },
    ] },
    { name: "displayName", type: "string", multiValued: false, required: false },
    { name: "active", type: "boolean", multiValued: false, required: false },
    { name: "emails", type: "complex", multiValued: true, required: false, subAttributes: [
      { name: "value", type: "string", multiValued: false, required: false },
      { name: "primary", type: "boolean", multiValued: false, required: false },
      { name: "type", type: "string", multiValued: false, required: false },
    ] },
    { name: "roles", type: "complex", multiValued: true, required: false, subAttributes: [
      { name: "value", type: "string", multiValued: false, required: false },
    ] },
  ],
  meta: { resourceType: "Schema", location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User" },
};

export async function GET(req: Request) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) return auth;
  return scimJson({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [USER_SCHEMA],
  });
}
