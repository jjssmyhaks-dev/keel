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
      { name: "Tokens" },
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
        CustomConnector: customConnectorSchema,
        Error: error,
      },
    },
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
