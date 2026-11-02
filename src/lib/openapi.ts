import { CONNECTORS } from "@/lib/connectors";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

const security = [{ bearerSecretKey: [] }];
const agentSecurity = [{ bearerAgentToken: [] }];

const nullableString = { type: ["string", "null"] };

export const OPENAPI_SECURITY_SCHEMES = {
  bearerSecretKey: {
    type: "http",
    scheme: "bearer",
    description: "Secret API key: `sk_dev_…` or `sk_prod_…`.",
  },
  bearerAgentToken: {
    type: "http",
    scheme: "bearer",
    description: "Short-lived agent access token from POST /agents/{id}/token.",
  },
} as const;

const agentSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "agt_atlas" },
    object: { type: "string", example: "agent" },
    name: { type: "string" },
    description: nullableString,
    status: { type: "string", enum: ["active", "paused", "suspended", "revoked"] },
    fingerprint: { type: "string" },
    publicKey: nullableString,
    keyMode: { type: "string", enum: ["client", "platform"] },
    tags: { type: "array", items: { type: "string" } },
    framework: nullableString,
    autonomousMode: { type: "boolean" },
    safeLaunchUntil: { type: ["string", "null"], format: "date-time" },
    environmentId: { type: "string" },
    lastActiveAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const connectorSchema = {
  type: "object",
  properties: {
    object: { type: "string", example: "connector" },
    slug: { type: "string", example: "slack" },
    name: { type: "string", example: "Slack" },
    category: { type: "string" },
    description: { type: "string" },
    status: { type: "string", enum: ["stable", "beta"] },
    version: { type: "string" },
    authMethods: { type: "array", items: { type: "string" } },
    defaultAuth: { type: "string" },
    hosts: { type: "array", items: { type: "string" } },
    scopes: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", example: "slack.post_message" },
          label: { type: "string" },
          description: { type: "string" },
          method: { type: "string" },
          risk: { type: "string", enum: ["read", "write", "destructive", "financial"] },
          fields: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    },
  },
};

const list = (ref: string) => ({
  type: "object",
  properties: {
    object: { type: "string", example: "list" },
    data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
  },
});

const error = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
      },
    },
  },
};

const idParam = { $ref: "#/components/parameters/Id" };

const json = (schema: object) => ({ "application/json": { schema } });

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Keel Platform API",
      version: "1.0.0",
      description:
        "Identity, vault, policy and proxy API for AI agents. Secret keys are environment-scoped. Agent tokens are short-lived EdDSA JWTs.",
      contact: { name: "Keel", url: "https://keel.dev/docs" },
      license: { name: "Proprietary" },
    },
    servers: [{ url: "/api/v1", description: "This deployment" }],
    security,
    tags: [
      { name: "Agents" },
      { name: "Tokens" },
      { name: "Vault" },
      { name: "Grants" },
      { name: "Approvals" },
      { name: "Proxy" },
      { name: "Audit" },
      { name: "Webhooks" },
      { name: "Account" },
    ],
    paths: {
      "/me": {
        get: {
          tags: ["Account"],
          summary: "Describe the calling key and environment",
          security,
          responses: {
            "200": {
              description: "Key, organization, project and environment for this credential.",
              content: json({
                type: "object",
                properties: {
                  object: { type: "string", example: "api_key_context" },
                  key: { type: ["object", "null"], additionalProperties: true },
                  organization: { type: "object", additionalProperties: true },
                  project: { type: "object", additionalProperties: true },
                  environment: { type: "object", additionalProperties: true },
                },
              }),
            },
            "401": { description: "Missing or invalid key", content: json(error) },
          },
        },
      },
      "/connectors": {
        get: {
          tags: ["Proxy"],
          summary: "List connectors and their actions",
          security,
          responses: {
            "200": {
              description: "Connector catalogue for this deployment.",
              content: json(list("Connector")),
            },
            "401": { description: "Missing or invalid key", content: json(error) },
          },
        },
      },
      "/agents": {
        get: {
          tags: ["Agents"],
          summary: "List agents",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "tag", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "A list of agents", content: json(list("Agent")) } },
        },
        post: {
          tags: ["Agents"],
          summary: "Register an agent",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                framework: { type: "string" },
                publicKey: { type: "string", description: "PEM public key for bring-your-own-key mode." },
                keyMode: { type: "string", enum: ["client", "platform"] },
                autonomousMode: { type: "boolean" },
              },
            }),
          },
          responses: {
            "201": {
              description: "Agent created. The private key is returned once for managed identities.",
              content: json(agentSchema),
            },
          },
        },
      },
      "/agents/{id}": {
        get: {
          tags: ["Agents"],
          summary: "Retrieve an agent",
          parameters: [idParam],
          responses: { "200": { description: "Agent", content: json(agentSchema) } },
        },
        patch: {
          tags: ["Agents"],
          summary: "Update an agent",
          parameters: [idParam],
          responses: { "200": { description: "Updated agent", content: json(agentSchema) } },
        },
        delete: {
          tags: ["Agents"],
          summary: "Revoke an agent",
          parameters: [idParam],
          responses: { "200": { description: "Revoked agent", content: json(agentSchema) } },
        },
      },
      "/agents/{id}/{action}": {
        post: {
          tags: ["Agents", "Tokens"],
          summary: "Agent actions: token, pause, resume, suspend, revoke, kill, rotate-key, transfer, promote",
          parameters: [
            idParam,
            {
              name: "action",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: ["token", "pause", "resume", "suspend", "revoke", "kill", "rotate-key", "transfer", "promote"],
              },
            },
          ],
          requestBody: {
            content: json({
              type: "object",
              properties: {
                challenge: { type: "string", description: "`<unix-seconds>.<nonce>` for signed token requests." },
                signature: { type: "string", description: "Base64 Ed25519 signature over `<agentId>.<challenge>`." },
                keyId: { type: "string" },
                ttl: { type: "integer", minimum: 60, maximum: 3600, default: 300 },
                email: { type: "string", description: "For transfer and promote." },
              },
            }),
          },
          responses: {
            "200": { description: "Token or updated agent" },
            "401": { description: "Signature required or invalid", content: json(error) },
          },
        },
      },
      "/tokens/introspect": {
        post: {
          tags: ["Tokens"],
          summary: "Introspect an agent token",
          requestBody: {
            required: true,
            content: json({ type: "object", required: ["token"], properties: { token: { type: "string" } } }),
          },
          responses: { "200": { description: "Result with active flag and claims." } },
        },
      },
      "/tokens/revoke": {
        post: {
          tags: ["Tokens"],
          summary: "Revoke an agent token",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: { token: { type: "string" }, tokenId: { type: "string" }, agentId: { type: "string" } },
            }),
          },
          responses: { "200": { description: "Token revoked" } },
        },
      },
      "/credentials": {
        get: {
          tags: ["Vault"],
          summary: "List connections",
          parameters: [{ name: "connector", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Connections" } },
        },
        post: {
          tags: ["Vault"],
          summary: "Store a connection secret",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["connector", "secret"],
              properties: {
                connector: { type: "string", enum: CONNECTORS.map((c) => c.slug) },
                name: { type: "string" },
                type: { type: "string", enum: ["oauth", "api_key", "bearer", "basic"] },
                secret: { oneOf: [{ type: "string" }, { type: "object" }] },
                metadata: { type: "object" },
                expiresAt: { type: "string", format: "date-time" },
              },
            }),
          },
          responses: { "201": { description: "Encrypted and stored. The secret can never be read back." } },
        },
      },
      "/credentials/{id}": {
        get: {
          tags: ["Vault"],
          summary: "Retrieve connection metadata",
          parameters: [idParam],
          responses: { "200": { description: "Connection" } },
        },
        patch: {
          tags: ["Vault"],
          summary: "Rotate the secret or update metadata",
          parameters: [idParam],
          responses: { "200": { description: "Updated connection" } },
        },
        delete: {
          tags: ["Vault"],
          summary: "Revoke a connection",
          parameters: [idParam],
          responses: { "200": { description: "Revoked connection" } },
        },
      },
      "/grants": {
        get: { tags: ["Grants"], summary: "List grants", responses: { "200": { description: "Grants" } } },
        post: {
          tags: ["Grants"],
          summary: "Grant an agent access to a connection",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["agentId", "credentialId", "actions"],
              properties: {
                agentId: { type: "string" },
                credentialId: { type: "string" },
                actions: { type: "array", items: { type: "string" }, example: ["slack.post_message"] },
                resourcePattern: { type: "string", example: "support-*" },
                conditions: {
                  type: "object",
                  properties: {
                    allowedIps: { type: "string" },
                    timeWindowStart: { type: "string", example: "09:00" },
                    timeWindowEnd: { type: "string", example: "18:00" },
                    maxCallsPerPeriod: { type: "integer" },
                    periodHours: { type: "integer" },
                  },
                },
                approvalMode: { type: "string", enum: ["allow", "require_approval", "deny"] },
                purpose: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
              },
            }),
          },
          responses: { "201": { description: "Grant created" } },
        },
      },
      "/grants/{id}": {
        get: {
          tags: ["Grants"],
          summary: "Retrieve a grant",
          parameters: [idParam],
          responses: { "200": { description: "Grant" } },
        },
        patch: {
          tags: ["Grants"],
          summary: "Update a grant",
          parameters: [idParam],
          responses: { "200": { description: "Updated grant" } },
        },
        delete: {
          tags: ["Grants"],
          summary: "Remove a grant",
          parameters: [idParam],
          responses: { "200": { description: "Deleted grant" } },
        },
      },
      "/approval-policies": {
        get: { tags: ["Approvals"], summary: "List approval policies", responses: { "200": { description: "Policies" } } },
        post: { tags: ["Approvals"], summary: "Create an approval policy", responses: { "201": { description: "Policy created" } } },
      },
      "/approval-policies/{id}": {
        patch: {
          tags: ["Approvals"],
          summary: "Update an approval policy",
          parameters: [idParam],
          responses: { "200": { description: "Updated policy" } },
        },
        delete: {
          tags: ["Approvals"],
          summary: "Delete an approval policy",
          parameters: [idParam],
          responses: { "200": { description: "Deleted policy" } },
        },
      },
      "/approvals": {
        get: {
          tags: ["Approvals"],
          summary: "List approval requests",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["pending", "approved", "denied", "expired", "failed"] },
            },
            { name: "agent", in: "query", schema: { type: "string" } },
            { name: "risk", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Approvals" } },
        },
      },
      "/approvals/{id}": {
        get: {
          tags: ["Approvals"],
          summary: "Retrieve an approval",
          parameters: [idParam],
          responses: { "200": { description: "Approval" } },
        },
        post: {
          tags: ["Approvals"],
          summary: "Approve or deny",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["decision"],
              properties: {
                decision: { type: "string", enum: ["approve", "deny"] },
                note: { type: "string" },
                approveAlways: { type: "boolean" },
              },
            }),
          },
          responses: { "200": { description: "Decision recorded and action executed on approval." } },
        },
      },
      "/proxy/{connector}": {
        post: {
          tags: ["Proxy"],
          summary: "Execute a connector action on behalf of an agent",
          description:
            "Policy is evaluated first. The call either executes, opens an approval, or is denied. Credentials never leave the proxy.",
          security: agentSecurity,
          parameters: [
            {
              name: "connector",
              in: "path",
              required: true,
              schema: { type: "string", enum: CONNECTORS.map((c) => c.slug) },
            },
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["action"],
              properties: {
                action: { type: "string", example: "slack.post_message" },
                credentialId: { type: "string" },
                resource: { type: "string", example: "support-billing" },
                input: { type: "object", additionalProperties: true },
              },
            }),
          },
          responses: {
            "200": { description: "Executed" },
            "202": { description: "Pending approval" },
            "403": { description: "Denied by policy", content: json(error) },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/audit": {
        get: {
          tags: ["Audit"],
          summary: "Query the audit log",
          parameters: [
            { name: "action", in: "query", schema: { type: "string" } },
            { name: "agent", in: "query", schema: { type: "string" } },
            { name: "outcome", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "before", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "Hash-chained audit events" } },
        },
      },
      "/audit/export": {
        get: {
          tags: ["Audit"],
          summary: "Export the audit log as JSONL or CSV",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["jsonl", "csv"] } },
          ],
          responses: { "200": { description: "File download" } },
        },
      },
      "/audit/verify": {
        get: {
          tags: ["Audit"],
          summary: "Verify the audit hash chain",
          responses: { "200": { description: "Verification result" } },
        },
      },
      "/webhooks": {
        get: { tags: ["Webhooks"], summary: "List webhook endpoints", responses: { "200": { description: "Endpoints" } } },
        post: {
          tags: ["Webhooks"],
          summary: "Create a webhook endpoint",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["url", "events"],
              properties: {
                url: { type: "string", format: "uri" },
                events: { type: "array", items: { type: "string", enum: WEBHOOK_EVENTS.map((e) => e.value) } },
              },
            }),
          },
          responses: { "201": { description: "Endpoint created. The signing secret is returned once." } },
        },
      },
      "/webhooks/{id}": {
        get: {
          tags: ["Webhooks"],
          summary: "Retrieve a webhook endpoint and recent deliveries",
          parameters: [idParam],
          responses: { "200": { description: "Endpoint with its 50 most recent delivery attempts" } },
        },
        patch: {
          tags: ["Webhooks"],
          summary: "Update a webhook endpoint",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                url: { type: "string", format: "uri" },
                events: { type: "array", items: { type: "string", enum: WEBHOOK_EVENTS.map((e) => e.value) } },
                status: { type: "string", enum: ["active", "disabled"] },
              },
            }),
          },
          responses: { "200": { description: "Updated endpoint" } },
        },
        delete: {
          tags: ["Webhooks"],
          summary: "Delete a webhook endpoint",
          parameters: [idParam],
          responses: { "200": { description: "Endpoint deleted" } },
        },
      },
      "/jwks": {
        get: {
          tags: ["Tokens"],
          summary: "JSON Web Key Set",
          description: "Public Ed25519 keys used to verify agent tokens. Also served at /.well-known/jwks.json.",
          security: [],
          responses: { "200": { description: "Public keys for verifying agent tokens" } },
        },
      },
    },
    components: {
      securitySchemes: OPENAPI_SECURITY_SCHEMES,
      parameters: {
        Id: { name: "id", in: "path", required: true, schema: { type: "string" } },
      },
      schemas: {
        Agent: agentSchema,
        Connector: connectorSchema,
        Error: error,
      },
    },
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
