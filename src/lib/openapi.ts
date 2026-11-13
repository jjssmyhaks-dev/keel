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
    description:
      "Short-lived agent access token from POST /agents/{id}/token, /tokens/client-credentials, /tokens/exchange or /tokens/workload-exchange.",
  },
  dpopAgentToken: {
    type: "http",
    scheme: "DPoP",
    description: "DPoP-bound agent token plus a DPoP proof header for every request.",
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
    type: {
      type: "string",
      enum: ["support", "sales", "finance", "coding", "research", "operations", "data", "other"],
    },
    verificationVisibility: { type: "string", enum: ["public", "limited", "private"] },
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
    source: { type: "string", enum: ["builtin", "custom"] },
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
          risk: { type: "string", enum: ["read", "write", "destructive", "financial", "admin"] },
          fields: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    },
  },
};

const customConnectorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    object: { type: "string", example: "custom_connector" },
    slug: { type: "string" },
    name: { type: "string" },
    description: nullableString,
    category: { type: "string" },
    version: { type: "integer" },
    specVersion: { type: "string", example: "3.1.0" },
    status: { type: "string", enum: ["active", "archived"] },
    archivedAt: { type: ["string", "null"], format: "date-time" },
    hosts: { type: "array", items: { type: "string" } },
    auth: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["api_key", "bearer", "basic"] },
        methods: { type: "array", items: { type: "object", additionalProperties: true } },
      },
    },
    credentialFields: { type: "array", items: { type: "object", additionalProperties: true } },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          method: { type: "string" },
          path: { type: "string" },
          risk: { type: "string", enum: ["read", "write", "destructive", "financial", "admin"] },
          host: { type: "string" },
          bodyFormat: { type: "string", enum: ["json", "form"] },
        },
      },
    },
    healthCheck: { type: ["object", "null"], additionalProperties: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    versions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          version: { type: "integer" },
          specVersion: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
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

const consentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    agentId: { type: "string" },
    agentName: nullableString,
    endUserId: { type: "string" },
    scopes: { type: "array", items: { type: "string" } },
    grantedAt: { type: "string", format: "date-time" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    revokedAt: { type: ["string", "null"], format: "date-time" },
    lastUsedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const endUserSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    externalUserId: { type: "string" },
    email: nullableString,
    createdAt: { type: "string", format: "date-time" },
    lastSeenAt: { type: ["string", "null"], format: "date-time" },
    consents: { type: "array", items: consentSchema },
    connections: {
      type: "array",
      description: "Present on the detail endpoint. Credentials created on this end user's behalf.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          connector: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
    dataRequests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
  },
};

const trustRelationshipSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["invited", "active", "declined", "revoked"] },
    note: nullableString,
    maxScopes: { type: "array", items: { type: "string" } },
    ownerEnvironmentId: { type: "string" },
    externalEnvironmentId: { type: "string" },
    shadowAgentId: nullableString,
    invitedAt: { type: "string", format: "date-time" },
    acceptedAt: { type: ["string", "null"], format: "date-time" },
    revokedAt: { type: ["string", "null"], format: "date-time" },
    externalAgent: {
      type: ["object", "null"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        orgName: nullableString,
      },
    },
    shadowAgent: {
      type: ["object", "null"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
      },
    },
  },
};

const configFileSchema = {
  type: "object",
  required: ["version", "environment"],
  properties: {
    version: { type: "integer", enum: [1] },
    environment: { type: "string" },
    agents: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          description: nullableString,
          tags: { type: "array", items: { type: "string" } },
          autonomousMode: { type: "boolean" },
        },
      },
    },
    connections: {
      type: "array",
      description: "Referenced by name from grants; apply never creates or deletes connections.",
      items: {
        type: "object",
        required: ["name", "connector"],
        properties: {
          name: { type: "string" },
          connector: { type: "string" },
          type: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
        },
      },
    },
    grants: {
      type: "array",
      items: {
        type: "object",
        required: ["agent", "connection", "actions"],
        properties: {
          agent: { type: "string" },
          connection: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
          resource: { type: "string" },
          approvalMode: { type: ["string", "null"], enum: ["allow", "require_approval", "deny", null] },
          conditions: { type: "object", additionalProperties: true },
          expiresAt: nullableString,
        },
      },
    },
    approvalPolicies: {
      type: "array",
      items: {
        type: "object",
        required: ["agent", "actionPattern", "mode"],
        properties: {
          agent: nullableString,
          actionPattern: { type: "string" },
          mode: { type: "string", enum: ["allow", "require_approval", "deny"] },
          slaMinutes: { type: ["integer", "null"] },
          escalateToRole: nullableString,
        },
      },
    },
    webhooks: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "events"],
        properties: {
          url: { type: "string", format: "uri" },
          events: { type: "array", items: { type: "string" } },
        },
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
      title: "Authab Platform API",
      version: "1.0.0",
      description:
        "Identity, vault, policy and proxy API for AI agents. Secret keys are environment-scoped. Agent tokens are short-lived EdDSA JWTs.",
      contact: { name: "Authab", url: "https://authab.dev/docs" },
      license: { name: "Proprietary" },
    },
    servers: [{ url: "/api/v1", description: "This deployment" }],
    security,
    tags: [
      { name: "Agents" },
      { name: "Consent" },
      { name: "End users" },
      { name: "Trust" },
      { name: "Config" },
      { name: "Tokens" },
      { name: "Delegation" },
      { name: "Workload identity" },
      { name: "Vault" },
      { name: "Grants" },
      { name: "Approvals" },
      { name: "Policy" },
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
          summary: "List built-in and custom connectors",
          description:
            "Returns every connector usable in this environment — the built-in catalogue plus active custom imports — with a built-in summary and full custom connector metadata.",
          security,
          responses: {
            "200": {
              description: "Connector catalogue.",
              content: json({
                type: "object",
                properties: {
                  object: { type: "string", example: "list" },
                  data: { type: "array", items: { $ref: "#/components/schemas/Connector" } },
                  builtin: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        slug: { type: "string" },
                        name: { type: "string" },
                        category: { type: "string" },
                        version: { type: "string" },
                        actions: { type: "integer" },
                        auth: { type: "string" },
                      },
                    },
                  },
                  custom: { type: "array", items: { $ref: "#/components/schemas/CustomConnector" } },
                },
              }),
            },
            "401": { description: "Missing or invalid key", content: json(error) },
          },
        },
        post: {
          tags: ["Proxy"],
          summary: "Import a custom connector from OpenAPI 3",
          description:
            "Compiles an OpenAPI 3.0 or 3.1 JSON or YAML document into a connector. Requires the Scale or Enterprise plan. Re-importing an unchanged spec is a no-op.",
          security,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["spec"],
              properties: {
                spec: { type: "string", description: "OpenAPI 3 document as JSON or YAML." },
                slug: { type: "string", description: "Defaults to a slug derived from info.title." },
                name: { type: "string" },
                category: { type: "string" },
                color: { type: "string", example: "#25567a" },
                mark: { type: "string", maxLength: 3 },
                baseUrl: { type: "string", description: "HTTPS base URL when the spec has no absolute server." },
                authScheme: { type: "string", description: "components.securitySchemes key to use." },
              },
            }),
          },
          responses: {
            "201": { description: "Connector imported with its compiled actions and warnings." },
            "200": { description: "Spec unchanged; existing version kept." },
            "402": { description: "Plan does not include custom connectors", content: json(error) },
            "422": { description: "Spec could not be compiled", content: json(error) },
          },
        },
      },
      "/connectors/{slug}": {
        get: {
          tags: ["Proxy"],
          summary: "Retrieve a custom connector and its versions",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Connector with its version history." },
            "404": { description: "No custom connector with that slug", content: json(error) },
          },
        },
        delete: {
          tags: ["Proxy"],
          summary: "Archive a custom connector",
          description: "Archived connectors stop resolving for the dashboard, gateway and proxy.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Connector archived" },
            "404": { description: "No custom connector with that slug", content: json(error) },
          },
        },
      },
      "/connectors/{slug}/rollback": {
        post: {
          tags: ["Proxy"],
          summary: "Roll a custom connector back to a previous version",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["version"],
              properties: { version: { type: "integer", minimum: 1 } },
            }),
          },
          responses: {
            "200": { description: "Connector restored to the requested version as a new version." },
            "404": { description: "Connector or version not found", content: json(error) },
            "422": { description: "Invalid version", content: json(error) },
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
                type: {
                  type: "string",
                  enum: ["support", "sales", "finance", "coding", "research", "operations", "data", "other"],
                },
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
          requestBody: {
            content: json({
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: ["string", "null"] },
                tags: { type: "array", items: { type: "string" } },
                framework: { type: ["string", "null"] },
                type: {
                  type: "string",
                  enum: ["support", "sales", "finance", "coding", "research", "operations", "data", "other"],
                },
                verificationVisibility: { type: "string", enum: ["public", "limited", "private"] },
                autonomousMode: { type: "boolean" },
              },
            }),
          },
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
      "/agents/{id}/identity-document": {
        get: {
          tags: ["Agents"],
          summary: "Retrieve the signed identity document for an agent",
          description:
            "Returns the current EdDSA-signed identity document (`typ` = `agent-identity+jwt`) and its compact JWS. Document `doc_seq` increments on every re-issue; exactly one document per agent is current. Documents are issued on registration and re-issued whenever the agent's status, key fingerprint or visibility changes; fetching an agent created before documents existed backfills one on first read. Requires a secret key. Verify offline with the public keys from `/.well-known/jwks.json`.",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Current identity document",
              content: json({
                type: "object",
                properties: {
                  agentId: { type: "string" },
                  docSeq: { type: "integer", example: 3 },
                  document: {
                    type: "object",
                    properties: {
                      v: { type: "integer", example: 1 },
                      iss: { type: "string" },
                      iat: { type: "integer" },
                      doc_seq: { type: "integer" },
                      agent_id: { type: "string" },
                      key_fingerprint: { type: "string" },
                      public_jwk: {
                        type: "object",
                        properties: { kty: { type: "string" }, crv: { type: "string" }, x: { type: "string" } },
                      },
                      org_ref: { type: "string" },
                      environment: { type: "string", enum: ["development", "production"] },
                      status: { type: "string", enum: ["active", "paused", "suspended", "revoked"] },
                      visibility: { type: "string", enum: ["public", "limited", "private"] },
                      created_at: { type: "string", format: "date-time" },
                    },
                  },
                  jws: { type: "string" },
                  issuerKeyId: { type: "string" },
                  issuedAt: { type: "string", format: "date-time" },
                },
              }),
            },
            "401": { description: "Missing or invalid API key", content: json(error) },
            "403": { description: "Publishable keys cannot read identity documents", content: json(error) },
            "404": { description: "Agent not found in this environment", content: json(error) },
            "503": { description: "The document could not be issued; retry", content: json(error) },
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
      "/tokens/client-credentials": {
        post: {
          tags: ["Tokens"],
          summary: "OAuth 2.1 client-credentials grant",
          description:
            "Exchanges an agent client secret for a short-lived access token. Accepts JSON or application/x-www-form-urlencoded, plus HTTP Basic client authentication. Add a DPoP proof header to receive a key-bound token.",
          security: [],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                client_id: { type: "string", description: "Agent ID. May also be sent with Basic auth." },
                client_secret: { type: "string" },
                scope: { type: "string", description: "Space-separated subset of the secret's scopes." },
                ttl: { type: "integer", minimum: 60, maximum: 3600, default: 300 },
              },
            }),
          },
          responses: {
            "200": { description: "access_token, token_type, expires_in, scope and token_id" },
            "401": { description: "Invalid client credentials", content: json(error) },
          },
        },
      },
      "/tokens/exchange": {
        post: {
          tags: ["Tokens"],
          summary: "RFC 8693 token exchange with delegation",
          description:
            "Presents a valid agent access token as subject_token. Re-scoping the same agent needs no further setup. Delegating to another agent requires an active delegation record from the caller to the target and can never exceed the caller's scopes, the target agent's grants or the delegation's scope list. The issued token carries the RFC 8693 act chain plus delegation and ancestor-token claims that are re-checked on every call.",
          security: [],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["subject_token"],
              properties: {
                subject_token: { type: "string" },
                subject_token_type: {
                  type: "string",
                  enum: ["urn:ietf:params:oauth:token-type:access_token"],
                },
                agent_id: {
                  type: "string",
                  description: "Target agent to act as. Requires an active delegation; omit to re-scope the same agent.",
                },
                scope: { type: "string" },
                ttl: { type: "integer", minimum: 60, maximum: 3600 },
              },
            }),
          },
          responses: {
            "200": { description: "Delegated access token with act claim" },
            "400": { description: "invalid_scope or invalid_dpop_proof", content: json(error) },
            "401": { description: "Invalid subject token", content: json(error) },
            "403": { description: "delegation_required, delegation_inactive or agent_inactive", content: json(error) },
          },
        },
      },
      "/delegations": {
        get: {
          tags: ["Tokens", "Delegation"],
          summary: "List delegations",
          description: "Filter with ?agent= to show relationships where the agent is the parent or child.",
          responses: { "200": { description: "Delegations with parent and child agent summaries" } },
        },
        post: {
          tags: ["Tokens", "Delegation"],
          summary: "Record a delegation",
          description:
            "Scopes must be a subset of the parent agent's grants. A delegation narrows access; it never adds permissions.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["parentAgentId", "childAgentId", "scopes"],
              properties: {
                parentAgentId: { type: "string" },
                childAgentId: { type: "string" },
                scopes: { type: "array", items: { type: "string" } },
                purpose: { type: "string", maxLength: 280 },
                expiresAt: { type: "string", format: "date-time" },
                restrictions: {
                  type: "object",
                  properties: {
                    maxTtlSeconds: { type: "integer", minimum: 60, maximum: 3600 },
                    resourceSubset: { type: "string" },
                    maxCalls: { type: "integer", minimum: 1 },
                  },
                },
              },
            }),
          },
          responses: {
            "201": { description: "Delegation created" },
            "422": { description: "invalid_scopes or invalid_restrictions", content: json(error) },
          },
        },
      },
      "/delegations/{id}": {
        delete: {
          tags: ["Tokens", "Delegation"],
          summary: "Revoke a delegation",
          description: "Revocation is immediate: tokens issued under this delegation fail verification on the next call.",
          parameters: [idParam],
          responses: { "200": { description: "Delegation revoked" } },
        },
      },
      "/tokens/workload-exchange": {
        post: {
          tags: ["Tokens", "Workload identity"],
          summary: "Exchange a SPIFFE or Kubernetes workload JWT",
          description:
            "Verifies the workload's JWT against a registered issuer and JWKS, then issues an Authab access token for the mapped agent. No static secret is stored on the workload.",
          security: [],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["token"],
              properties: {
                token: { type: "string", description: "The workload JWT-SVID or service-account token." },
                scope: { type: "string" },
                ttl: { type: "integer", minimum: 60, maximum: 3600 },
              },
            }),
          },
          responses: {
            "200": { description: "Access token for the mapped agent" },
            "401": { description: "Workload token rejected", content: json(error) },
          },
        },
      },
      "/workload-identities": {
        get: {
          tags: ["Workload identity"],
          summary: "List trusted workload issuers",
          responses: { "200": { description: "Workload identities" } },
        },
        post: {
          tags: ["Workload identity"],
          summary: "Register a workload issuer",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["name", "issuer", "audience", "agentId"],
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["spiffe", "kubernetes", "custom"] },
                issuer: { type: "string" },
                audience: { type: "string" },
                agentId: { type: "string" },
                subjectPattern: { type: "string", description: "Glob pattern such as system:serviceaccount:prod:agent-*." },
                jwksUrl: { type: "string", description: "Exactly one of jwksUrl or jwksJson is required." },
                jwksJson: { type: "string" },
                requiredClaims: { type: "object" },
                tokenTtlSeconds: { type: "integer", minimum: 60, maximum: 3600, default: 300 },
                enabled: { type: "boolean" },
              },
            }),
          },
          responses: { "201": { description: "Workload identity created" } },
        },
      },
      "/workload-identities/{id}": {
        get: {
          tags: ["Workload identity"],
          summary: "Retrieve a workload identity",
          parameters: [idParam],
          responses: { "200": { description: "Workload identity" } },
        },
        patch: {
          tags: ["Workload identity"],
          summary: "Update or disable a workload identity",
          parameters: [idParam],
          responses: { "200": { description: "Updated workload identity" } },
        },
        delete: {
          tags: ["Workload identity"],
          summary: "Remove a workload identity",
          parameters: [idParam],
          responses: { "200": { description: "Workload identity removed" } },
        },
      },
      "/agents/{id}/client-secrets": {
        get: {
          tags: ["Agents", "Tokens"],
          summary: "List client secrets",
          parameters: [idParam],
          responses: { "200": { description: "Secret metadata. Raw secrets are never returned again." } },
        },
        post: {
          tags: ["Agents", "Tokens"],
          summary: "Issue a client secret",
          description: "The raw secret is returned once. Only its SHA-256 hash is stored.",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                label: { type: "string", maxLength: 60 },
                scopes: { type: "array", items: { type: "string" } },
                expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
              },
            }),
          },
          responses: {
            "201": { description: "Client secret created. Copy the secret now." },
            "422": { description: "Scopes exceed the agent's grants", content: json(error) },
          },
        },
      },
      "/agents/{id}/client-secrets/{secretId}": {
        delete: {
          tags: ["Agents", "Tokens"],
          summary: "Revoke a client secret",
          parameters: [
            idParam,
            { name: "secretId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Secret revoked" } },
        },
      },
      "/credentials/{id}/refresh": {
        post: {
          tags: ["Vault"],
          summary: "Refresh an OAuth connection token",
          description: "Runs the provider's refresh grant and persists the rotated tokens. Existing grants keep working.",
          parameters: [idParam],
          responses: {
            "200": { description: "Credential refreshed" },
            "409": { description: "This connection has no refresh token", content: json(error) },
            "502": { description: "The provider rejected the refresh", content: json(error) },
          },
        },
      },
      "/credentials/{id}/check": {
        post: {
          tags: ["Vault"],
          summary: "Probe a connection's health now",
          description: "Runs the connector's read-only health check and records the result.",
          parameters: [idParam],
          responses: { "200": { description: "Check result and updated connection" } },
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
                  description:
                    "Fail-closed conditions evaluated on every call. IP rules accept IPv4/IPv6 addresses or CIDR ranges.",
                  properties: {
                    allowedIps: { type: "string", example: "203.0.113.0/24, 2001:db8::/32" },
                    allowedDays: { type: "string", example: "mon,tue,wed,thu,fri" },
                    timezone: { type: "string", example: "UTC" },
                    timeWindowStart: { type: "string", example: "09:00" },
                    timeWindowEnd: { type: "string", example: "18:00" },
                    maxAmount: { type: "number", description: "Deny calls whose amount field exceeds this value." },
                    approvalAboveAmount: { type: "number", description: "Require approval above this amount." },
                    amountField: { type: "string", description: "Input field that carries the amount. Defaults to amount." },
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
      "/grants/request": {
        post: {
          tags: ["Grants"],
          summary: "Request a just-in-time grant",
          description:
            "Agent-authenticated request for time-boxed access. Creates a pending approval; an approver must activate the grant before the proxy allows calls. Limited to 10 open requests per agent per minute.",
          security: agentSecurity,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["actions", "reason"],
              properties: {
                credentialId: { type: "string" },
                credential: { type: "string", description: "Alias for credentialId." },
                connector: { type: "string", description: "Use the environment's oldest connection for this connector." },
                actions: { type: "array", items: { type: "string" }, example: ["github.issues.create"] },
                resourcePattern: { type: "string" },
                reason: { type: "string", minLength: 5, maxLength: 500 },
                durationMinutes: { type: "integer", minimum: 1 },
              },
            }),
          },
          responses: {
            "202": {
              description: "Pending approval. The grant is not usable until it is activated.",
              content: json({
                type: "object",
                properties: {
                  object: { type: "string", example: "grant_request" },
                  status: { type: "string", example: "pending_approval" },
                  approvalId: { type: "string" },
                  grantId: { type: "string" },
                  approvalUrl: { type: "string" },
                  expiresAt: { type: ["string", "null"], format: "date-time" },
                },
              }),
            },
            "404": { description: "No matching connection", content: json(error) },
            "409": { description: "A grant or request already exists", content: json(error) },
            "422": { description: "Missing reason, actions or invalid duration", content: json(error) },
            "429": { description: "Too many requests", content: json(error) },
          },
        },
      },
      "/policy/simulate": {
        post: {
          tags: ["Policy"],
          summary: "Simulate a policy decision",
          description:
            "Runs the same policy pipeline as the proxy without executing the provider call or consuming the grant. Returns the effect, the matched grant and the full trace. Requires a secret key.",
          security,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["agentId", "credentialId", "action"],
              properties: {
                agentId: { type: "string" },
                credentialId: { type: "string" },
                action: { type: "string", example: "github.issues.create" },
                resource: { type: "string" },
                input: { type: "object", additionalProperties: true },
                ip: { type: "string", description: "Client IP to evaluate against CIDR conditions." },
                now: { type: "string", format: "date-time", description: "Evaluate time conditions at this instant." },
              },
            }),
          },
          responses: {
            "200": {
              description: "Simulated decision with trace.",
              content: json({
                type: "object",
                properties: {
                  object: { type: "string", example: "policy_simulation" },
                  simulated: { type: "boolean", example: true },
                  evaluatedAt: { type: "string", format: "date-time" },
                  decision: {
                    type: "object",
                    properties: {
                      effect: { type: "string", enum: ["allow", "deny", "require_approval"] },
                      reason: { type: "string" },
                      risk: { type: "string", enum: ["read", "write", "destructive", "financial", "admin"] },
                      source: { type: "string" },
                      wouldExecute: { type: "boolean" },
                      wouldRequestApproval: { type: "boolean" },
                    },
                  },
                  trace: { type: "array", items: { type: "object", additionalProperties: true } },
                  requestId: { type: "string" },
                },
              }),
            },
            "404": { description: "Agent or connection not found", content: json(error) },
            "422": { description: "Missing or invalid parameters", content: json(error) },
          },
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
      "/revocations": {
        get: {
          tags: ["Agents"],
          summary: "List revocations in this environment",
          description:
            "Returns a signed revocation list (`typ` = `agent-revocations+jwt`) scoped to the caller's environment. Entries are recorded by the kill action, `DELETE /agents/{id}` and revoke. `since` is inclusive; when a page is full, pass `next` back as `cursor`. `etag` is the SHA-256 of the revoked entries only, so it stays stable while `iat`/`exp` move; send it as `If-None-Match` to receive 304. Responses use `Cache-Control: private, max-age=30`, and the JWS expires ten minutes after `iat`. Requires a secret key.",
          parameters: [
            { name: "since", in: "query", description: "Inclusive ISO 8601 lower bound on revoked_at.", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", description: "Page size. next is set to the last row id when the page is full.", schema: { type: "integer", default: 1000, minimum: 1, maximum: 5000 } },
            { name: "cursor", in: "query", description: "The next value from the previous page. Cursors are environment-scoped.", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Signed revocation page",
              headers: {
                ETag: { description: "SHA-256 of the revoked list; also returned as etag in the body.", schema: { type: "string" } },
                "Cache-Control": { description: "private, max-age=30", schema: { type: "string" } },
              },
              content: json({
                type: "object",
                properties: {
                  jws: { type: "string", description: "EdDSA JWS with typ agent-revocations+jwt; payload covers v, iss, iat, exp, environment and revoked[]." },
                  etag: { type: "string" },
                  next: { type: ["string", "null"], description: "Cursor for the next page, or null when this page is complete." },
                },
              }),
            },
            "304": {
              description: "No change since the supplied ETag",
              headers: {
                ETag: { description: "The current list ETag.", schema: { type: "string" } },
                "Cache-Control": { description: "private, max-age=30", schema: { type: "string" } },
              },
            },
            "401": { description: "Missing or invalid API key", content: json(error) },
            "403": { description: "Publishable keys cannot read the revocation list", content: json(error) },
            "422": { description: "invalid_since or invalid_cursor", content: json(error) },
          },
        },
      },
      "/consent/requests": {
        post: {
          tags: ["Consent"],
          summary: "Create a hosted consent request",
          description:
            "Creates a pending request and returns the hosted URL to redirect the end user to. The end user approves, declines or edits scopes on Authab's domain. A one-time code is appended to `redirectUri` on approval. Consent can only be requested for internal agents, and destructive or financial scopes never appear in development or sandbox environments.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["agentId", "redirectUri", "endUser"],
              properties: {
                agentId: { type: "string" },
                scopes: {
                  type: "array",
                  items: { type: "string" },
                  description: "Action scopes such as slack.post_message. At most 50.",
                },
                connectors: { type: "array", items: { type: "string" } },
                endUser: {
                  type: "object",
                  required: ["externalUserId"],
                  properties: {
                    externalUserId: { type: "string", description: "Your identifier for this end user." },
                    email: nullableString,
                  },
                },
                redirectUri: { type: "string", format: "uri", description: "Where the end user returns after deciding." },
                state: { type: "string", description: "Returned unchanged on the callback. Stored up to 200 characters." },
                expiresInMinutes: { type: "integer", minimum: 5, maximum: 1440, default: 30 },
                durationOptions: {
                  type: "array",
                  items: { type: "string", enum: ["session", "30d", "until_revoked"] },
                  description: "Let the end user pick how long the consent lasts.",
                },
              },
            }),
          },
          responses: {
            "201": {
              description: "Request created. Redirect the end user to `url`.",
              content: json({
                type: "object",
                properties: {
                  id: { type: "string" },
                  url: { type: "string", format: "uri" },
                  expiresAt: { type: "string", format: "date-time" },
                },
              }),
            },
            "409": { description: "agent_inactive", content: json(error) },
            "422": {
              description:
                "agent_required, redirect_required, end_user_required, invalid_expiry, scopes_required, too_many_scopes, scope_unknown, scope_not_allowed or connector_not_found",
              content: json(error),
            },
          },
        },
      },
      "/consent/token": {
        post: {
          tags: ["Consent"],
          summary: "Exchange a consent code for an agent token",
          description:
            "Called from your redirect handler with the one-time `code` and the same `redirectUri` used to create the request. The code is single-use and expires five minutes after approval. The returned token carries `end_user` and `consent` claims and only the consented scopes.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["code", "redirectUri"],
              properties: {
                code: { type: "string" },
                redirectUri: { type: "string", format: "uri" },
              },
            }),
          },
          responses: {
            "200": {
              description: "Consent-scoped agent token",
              content: json({
                type: "object",
                properties: {
                  agentToken: { type: "string" },
                  expiresIn: { type: "integer", example: 300 },
                  consentId: { type: "string" },
                  endUserId: { type: "string" },
                  scopes: { type: "array", items: { type: "string" } },
                },
              }),
            },
            "409": { description: "code_used, code_expired, consent_inactive or invalid_code", content: json(error) },
            "422": { description: "invalid_code or redirect_mismatch", content: json(error) },
          },
        },
      },
      "/consent/{id}/token": {
        post: {
          tags: ["Consent"],
          summary: "Mint another token for an active consent",
          description:
            "Short-lived agent tokens can be minted repeatedly while the underlying consent is active. Revoking the consent blocks every later mint. Requires a secret key.",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Consent-scoped agent token",
              content: json({
                type: "object",
                properties: {
                  agentToken: { type: "string" },
                  expiresIn: { type: "integer" },
                  consentId: { type: "string" },
                  endUserId: { type: "string" },
                  scopes: { type: "array", items: { type: "string" } },
                  expiresAt: nullableString,
                },
              }),
            },
            "404": { description: "consent_not_found", content: json(error) },
            "409": { description: "consent_inactive", content: json(error) },
          },
        },
      },
      "/consent/{id}/revoke": {
        post: {
          tags: ["Consent"],
          summary: "Revoke a consent",
          description:
            "Revokes the consent, expires every grant created through it, and writes a hash-chained audit event. Requires a secret key.",
          parameters: [idParam],
          requestBody: {
            content: json({
              type: "object",
              properties: {
                reason: { type: "string", maxLength: 200, example: "customer_revoked" },
              },
            }),
          },
          responses: {
            "200": {
              description: "Consent revoked",
              content: json({
                type: "object",
                properties: {
                  id: { type: "string" },
                  agentId: { type: "string" },
                  endUserId: { type: "string" },
                  revokedAt: nullableString,
                },
              }),
            },
            "404": { description: "consent_not_found", content: json(error) },
          },
        },
      },
      "/end-users": {
        get: {
          tags: ["End users"],
          summary: "List end users",
          description:
            "Returns up to 200 end users in this project with their consents and data requests. Soft-deleted end users are excluded. Requires a secret key.",
          responses: {
            "200": { description: "End users", content: json(list("EndUser")) },
            "403": { description: "Publishable keys cannot list end users", content: json(error) },
          },
        },
      },
      "/end-users/{externalUserId}": {
        get: {
          tags: ["End users"],
          summary: "Retrieve an end user",
          description:
            "Consents, connections created on this end user's behalf, and data requests. Looked up by your external id, not by a raw email address.",
          parameters: [
            {
              name: "externalUserId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "End user", content: json({ $ref: "#/components/schemas/EndUser" }) },
            "404": { description: "end_user_not_found", content: json(error) },
          },
        },
      },
      "/end-users/{externalUserId}/control-link": {
        post: {
          tags: ["End users"],
          summary: "Issue a control-center link",
          description:
            "Creates a 15-minute, single-purpose link the end user can open to see and revoke their own consents and connections. Use it for in-app 'manage access' buttons and support flows. Requires a secret key.",
          parameters: [
            {
              name: "externalUserId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "201": {
              description: "Control-center link",
              content: json({
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  expiresAt: { type: "string", format: "date-time" },
                },
              }),
            },
            "404": { description: "end_user_not_found", content: json(error) },
          },
        },
      },
      "/trust-relationships": {
        get: {
          tags: ["Trust"],
          summary: "List cross-organization trust relationships",
          description:
            "`side=owner` lists invitations this environment sent; `side=external` lists invitations it received. Requires a secret key.",
          parameters: [
            { name: "side", in: "query", schema: { type: "string", enum: ["owner", "external"], default: "owner" } },
          ],
          responses: {
            "200": {
              description: "Relationships for the requested side",
              content: json({
                type: "object",
                properties: {
                  side: { type: "string", enum: ["owner", "external"] },
                  relationships: {
                    type: "array",
                    items: { $ref: "#/components/schemas/TrustRelationship" },
                  },
                },
              }),
            },
            "422": { description: "invalid_side", content: json(error) },
          },
        },
        post: {
          tags: ["Trust"],
          summary: "Invite another organization's agent",
          description:
            "Invites an internal agent in the same environment type (production↔production, development↔development) from a different organization. The invitation never grants access by itself; the external organization must accept.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["externalAgentId"],
              properties: {
                externalAgentId: { type: "string" },
                note: { type: "string", maxLength: 500 },
                maxScopes: {
                  type: "array",
                  items: { type: "string" },
                  description: "Upper bound on what the external agent may request later.",
                },
              },
            }),
          },
          responses: {
            "201": {
              description: "Invitation created",
              content: json({ $ref: "#/components/schemas/TrustRelationship" }),
            },
            "404": { description: "agent_not_found", content: json(error) },
            "409": { description: "relationship_exists", content: json(error) },
            "422": {
              description:
                "external_agent_required, agent_not_internal, agent_inactive, agent_private, environment_mismatch or same_organization",
              content: json(error),
            },
          },
        },
      },
      "/trust-relationships/{id}/accept": {
        post: {
          tags: ["Trust"],
          summary: "Accept a trust invitation",
          description:
            "Accepted from the external organization. Creates the shadow agent in the owner's environment that the external agent will call through, and dispatches `trust.accepted`. Requires a secret key.",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Relationship active",
              content: json({
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", example: "active" },
                  shadowAgentId: { type: "string" },
                },
              }),
            },
            "403": { description: "not_external_agent", content: json(error) },
            "409": { description: "trust_inactive", content: json(error) },
          },
        },
      },
      "/trust-relationships/{id}/decline": {
        post: {
          tags: ["Trust"],
          summary: "Decline a trust invitation",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Relationship declined",
              content: json({
                type: "object",
                properties: { id: { type: "string" }, status: { type: "string", example: "declined" } },
              }),
            },
            "403": { description: "not_external_agent", content: json(error) },
          },
        },
      },
      "/trust-relationships/{id}/revoke": {
        post: {
          tags: ["Trust"],
          summary: "Revoke a trust relationship",
          description:
            "Either side can revoke. The shadow agent is revoked and added to the owner environment's signed revocation list, so tokens on it stop verifying. Idempotent.",
          parameters: [idParam],
          responses: {
            "200": {
              description: "Relationship revoked",
              content: json({
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", example: "revoked" },
                  revokedAt: { type: "string", format: "date-time" },
                  alreadyRevoked: { type: "boolean" },
                },
              }),
            },
          },
        },
      },
      "/tokens/trust-exchange": {
        post: {
          tags: ["Trust"],
          summary: "Exchange a trust relationship for a shadow-agent token",
          description:
            "Called by the external agent with its own token. Narrows the shadow agent's grants to the relationship's `maxScopes` and the requested scopes, then issues a 5-minute token with `act`, `x_org` and `trust` claims. Rate limited to 120 requests per minute per agent.",
          security: agentSecurity,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["trustRelationshipId"],
              properties: {
                trustRelationshipId: { type: "string" },
                scopes: { type: "array", items: { type: "string" } },
                ttl: { type: "integer", minimum: 60, maximum: 300, default: 300 },
              },
            }),
          },
          responses: {
            "200": {
              description: "Shadow-agent token",
              content: json({
                type: "object",
                properties: {
                  access_token: { type: "string" },
                  token_type: { type: "string", example: "Bearer" },
                  expires_in: { type: "integer" },
                  expires_at: { type: "string", format: "date-time" },
                  token_id: { type: "string" },
                  scope: { type: "string" },
                  scopes: { type: "array", items: { type: "string" } },
                  trust: { type: "string" },
                  x_org: { type: "boolean", example: true },
                  agent: { type: "object", additionalProperties: true },
                },
              }),
            },
            "403": { description: "not_external_agent", content: json(error) },
            "404": { description: "trust_not_found", content: json(error) },
            "409": { description: "trust_inactive, agent_inactive, shadow_agent_missing or shadow_agent_inactive", content: json(error) },
            "422": { description: "trust_relationship_required or no_scopes", content: json(error) },
            "429": { description: "rate_limited", content: json(error) },
          },
        },
      },
      "/config/export": {
        get: {
          tags: ["Config"],
          summary: "Export configuration as JSON or YAML",
          description:
            "Version 1 configuration for this environment: agents, connections (metadata only), grants, approval policies and webhook URLs. Secrets, credential payloads and end-user consent data are never exported.",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "yaml"], default: "json" } },
          ],
          responses: {
            "200": {
              description: "Configuration document",
              content: {
                ...json({ $ref: "#/components/schemas/ConfigFile" }),
                "application/yaml": { schema: { type: "string" } },
              },
            },
            "422": { description: "invalid_format", content: json(error) },
          },
        },
      },
      "/config/apply": {
        post: {
          tags: ["Config"],
          summary: "Apply configuration",
          description:
            "Validates a version 1 document, diffs it by natural keys, and writes in one transaction. `dryRun` returns the same plan without writing. `prune` deletes grants, approval policies and webhooks not present in the document; production prune additionally requires the `x-authab-confirm: prune` header. Connections are never created or deleted, and agent private keys and webhook signing secrets are returned once in `results`.",
          parameters: [
            {
              name: "x-authab-confirm",
              in: "header",
              description: "Send `prune` to allow pruning in a production environment.",
              schema: { type: "string", enum: ["prune"] },
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                config: { $ref: "#/components/schemas/ConfigFile" },
                yaml: { type: "string", description: "Alternative to config; parsed server-side." },
                dryRun: { type: "boolean", default: false },
                prune: { type: "boolean", default: false },
              },
            }),
          },
          responses: {
            "200": {
              description: "Plan and, unless dryRun, results",
              content: json({
                type: "object",
                properties: {
                  version: { type: "integer", example: 1 },
                  environment: { type: "string" },
                  dryRun: { type: "boolean" },
                  create: { type: "array", items: { type: "string" } },
                  update: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        changes: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                  delete: { type: "array", items: { type: "string" } },
                  warnings: { type: "array", items: { type: "string" } },
                  results: { type: "object", additionalProperties: true },
                },
              }),
            },
            "403": { description: "Plan limit or production confirmation required", content: json(error) },
            "409": { description: "ambiguous_name", content: json(error) },
            "422": {
              description:
                "config_required, invalid_yaml, unsupported_version, invalid_config, duplicate or unknown reference",
              content: json(error),
            },
          },
        },
      },
      "/jwks": {
        get: {
          tags: ["Tokens"],
          summary: "JSON Web Key Set",
          description: "Public Ed25519 keys used to verify agent tokens, identity documents and revocation lists. Also served at /.well-known/jwks.json.",
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
        CustomConnector: customConnectorSchema,
        Consent: consentSchema,
        EndUser: endUserSchema,
        TrustRelationship: trustRelationshipSchema,
        ConfigFile: configFileSchema,
        Error: error,
      },
    },
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
