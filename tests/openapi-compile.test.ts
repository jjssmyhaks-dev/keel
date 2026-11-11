import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorImportError, compileOpenApiSpec, slugify } from "../src/lib/custom-connectors";

function expectImportError(fn: () => unknown, code: string, pattern?: RegExp) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ConnectorImportError, `expected ConnectorImportError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail(`expected import to fail with ${code}`);
}

const mainSpec = {
  openapi: "3.0.3",
  info: { title: "Acme Records", description: "Manage records at Acme." },
  servers: [{ url: "https://api.acme.example/v2" }],
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-Acme-Key" },
    },
    parameters: {
      Limit: { name: "limit", in: "query", schema: { type: "integer" } },
    },
    schemas: {
      Record: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", title: "Record name", example: "Q3 report" },
          amount: { type: "number" },
        },
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    "/records": {
      get: {
        operationId: "listRecords",
        summary: "List records",
        parameters: [{ $ref: "#/components/parameters/Limit" }, { name: "cursor", in: "query" }],
      },
      post: {
        operationId: "createRecord",
        summary: "Create record",
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Record" } } },
        },
      },
    },
    "/records/{id}": {
      delete: {
        operationId: "deleteRecord",
        summary: "Delete record",
        parameters: [{ name: "id", in: "path", required: true }],
      },
    },
    "/secrets": {
      get: { operationId: "listSecrets", summary: "List issued credentials" },
    },
    "/records/{id}/refund": {
      post: { operationId: "refundRecord", summary: "Refund a payment" },
    },
    "/admin/users": {
      post: { operationId: "inviteUser", summary: "Invite a member" },
    },
  },
};

test("compiles a JSON spec with API-key injection", () => {
  const { connector, specVersion, warnings } = compileOpenApiSpec(JSON.stringify(mainSpec), {
    slug: "acme",
    category: "Records",
  });
  assert.equal(specVersion, "3.0.3");
  assert.deepEqual(warnings, []);
  assert.equal(connector.slug, "acme");
  assert.equal(connector.name, "Acme Records");
  assert.equal(connector.category, "Records");
  assert.deepEqual(connector.hosts, ["api.acme.example"]);
  assert.equal(connector.injection.type, "header");
  assert.equal(connector.injection.name, "X-Acme-Key");
  assert.equal(connector.injection.field, "api_key");
  assert.equal(connector.defaultAuth, "api_key");
  assert.deepEqual(connector.redactedFields, ["api_key"]);
  assert.equal(connector.credentialFields![0].key, "api_key");
  assert.deepEqual(connector.healthCheck, { method: "GET", path: "/v2/records" });

  const byName = new Map(connector.actions.map((action) => [action.name, action]));
  assert.deepEqual([...byName.keys()].sort(), [
    "acme.createRecord",
    "acme.deleteRecord",
    "acme.inviteUser",
    "acme.listRecords",
    "acme.listSecrets",
    "acme.refundRecord",
  ]);

  const list = byName.get("acme.listRecords")!;
  assert.equal(list.method, "GET");
  assert.equal(list.path, "/v2/records");
  assert.equal(list.risk, "read");
  assert.deepEqual(list.queryFields, ["limit", "cursor"]);
  assert.deepEqual(
    list.fields?.map((field) => [field.key, field.required]),
    [
      ["limit", false],
      ["cursor", false],
    ],
  );

  const create = byName.get("acme.createRecord")!;
  assert.equal(create.risk, "write");
  assert.equal(create.bodyFormat, "json");
  assert.deepEqual(
    create.fields?.map((field) => [field.key, field.label, field.required, field.placeholder]),
    [
      ["name", "Record name", true, "Q3 report"],
      ["amount", "amount", false, undefined],
    ],
  );

  const remove = byName.get("acme.deleteRecord")!;
  assert.equal(remove.risk, "destructive");
  assert.equal(remove.path, "/v2/records/{id}");
  assert.deepEqual(remove.fields?.map((field) => [field.key, field.required]), [["id", true]]);

  assert.equal(byName.get("acme.listSecrets")!.risk, "admin");
  assert.equal(byName.get("acme.refundRecord")!.risk, "financial");
  assert.equal(byName.get("acme.inviteUser")!.risk, "admin");
  assert.equal(connector.status, "beta");
  assert.equal(connector.source, undefined);
});

test("parses YAML specs and compiles bearer injection", () => {
  const yaml = `
openapi: 3.1.0
info:
  title: YAML Service
servers:
  - url: https://yaml.example/api
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
paths:
  /ping:
    get:
      operationId: ping
      summary: Ping the service
`;
  const { connector, specVersion } = compileOpenApiSpec(yaml, { slug: "yaml-svc" });
  assert.equal(specVersion, "3.1.0");
  assert.equal(connector.name, "YAML Service");
  assert.equal(connector.defaultAuth, "bearer");
  assert.equal(connector.injection.type, "header");
  assert.equal(connector.injection.name, "Authorization");
  assert.equal(connector.injection.prefix, "Bearer ");
  assert.deepEqual(connector.credentialFields!.map((field) => field.key), ["token"]);
  assert.equal(connector.actions[0].name, "yaml-svc.ping");
  assert.equal(connector.actions[0].risk, "read");
  assert.deepEqual(connector.healthCheck, { method: "GET", path: "/api/ping" });
});

test("compiles HTTP basic security into username and password fields", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Basic API" },
    servers: [{ url: "https://basic.example" }],
    components: { securitySchemes: { basicAuth: { type: "http", scheme: "basic" } } },
    security: [{ basicAuth: [] }],
    paths: { "/me": { get: { operationId: "me" } } },
  };
  const { connector } = compileOpenApiSpec(JSON.stringify(spec), { slug: "basic-svc", authScheme: "basicAuth" });
  assert.equal(connector.defaultAuth, "basic");
  assert.deepEqual(connector.injection, {
    type: "header",
    name: "Authorization",
    basic: { usernameField: "username", passwordField: "password" },
  });
  assert.deepEqual(connector.credentialFields!.map((field) => field.key), ["username", "password"]);
  assert.equal(connector.credentialFields![1].secret, true);
});

test("expands server URL variables whose defaults are present", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Regional" },
    servers: [
      { url: "https://{region}.example.com/v1", variables: { region: { default: "us" } } },
      { url: "https://backup.example.com/v2" },
    ],
    components: { securitySchemes: { key: { type: "apiKey", in: "query", name: "key" } } },
    security: [{ key: [] }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  const { connector } = compileOpenApiSpec(JSON.stringify(spec), { slug: "vars" });
  assert.deepEqual(connector.hosts, ["us.example.com", "backup.example.com"]);
  assert.equal(connector.hosts[0], "us.example.com");
  assert.equal(connector.actions[0].path, "/v1/ping");
  assert.equal(connector.injection.type, "query");
  assert.equal(connector.injection.name, "key");
});

test("baseUrl overrides the spec servers", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "No servers" },
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  const { connector } = compileOpenApiSpec(JSON.stringify(spec), {
    slug: "override",
    baseUrl: "https://override.example/api/v3/",
  });
  assert.deepEqual(connector.hosts, ["override.example"]);
  assert.equal(connector.actions[0].path, "/api/v3/ping");
});

test("explicit x-authab-risk wins over inference", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Risk" },
    servers: [{ url: "https://risk.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/records/{id}": {
        delete: { operationId: "remove", "x-authab-risk": "read", parameters: [{ name: "id", in: "path", required: true }] },
      },
    },
  };
  const { connector } = compileOpenApiSpec(JSON.stringify(spec), { slug: "risk" });
  assert.equal(connector.actions[0].risk, "read");
});

test("form-encoded bodies are supported and unknown media types are skipped", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Forms" },
    servers: [{ url: "https://forms.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/submit": {
        post: {
          operationId: "submit",
          requestBody: {
            content: {
              "application/x-www-form-urlencoded": {
                schema: { type: "object", properties: { email: { type: "string" } } },
              },
            },
          },
        },
      },
      "/xml": {
        post: {
          operationId: "xmlOnly",
          requestBody: { content: { "application/xml": { schema: { type: "object" } } } },
        },
      },
    },
  };
  const { connector, warnings } = compileOpenApiSpec(JSON.stringify(spec), { slug: "forms" });
  assert.equal(connector.actions.length, 1);
  assert.equal(connector.actions[0].name, "forms.submit");
  assert.equal(connector.actions[0].bodyFormat, "form");
  assert.deepEqual(connector.actions[0].fields?.map((field) => field.key), ["email"]);
  assert.ok(warnings.some((warning) => warning.includes("only JSON and form-encoded request bodies")));
});

test("deprecated operations and operations that opt out of the scheme are skipped", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Skip" },
    servers: [{ url: "https://skip.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/live": { get: { operationId: "live" } },
      "/old": { get: { operationId: "old", deprecated: true } },
      "/open": { get: { operationId: "open", security: [] } },
    },
  };
  const { connector, warnings } = compileOpenApiSpec(JSON.stringify(spec), { slug: "skip" });
  assert.deepEqual(connector.actions.map((action) => action.name), ["skip.live"]);
  assert.ok(warnings.some((warning) => warning.includes('does not accept the "key" security scheme')));
});

test("duplicate operationIds are de-duplicated and missing ids derive a name from the path", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Names" },
    servers: [{ url: "https://names.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/a": { get: { operationId: "ping" } },
      "/b": { get: { operationId: "ping" } },
      "/things/{id}": { get: { parameters: [{ name: "id", in: "path", required: true }] } },
    },
  };
  const { connector } = compileOpenApiSpec(JSON.stringify(spec), { slug: "names" });
  assert.deepEqual(connector.actions.map((action) => action.name), [
    "names.ping",
    "names.ping_2",
    "names.get_things_id",
  ]);
});

test("path traversal entries are skipped with a warning", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Traversal" },
    servers: [{ url: "https://safe.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/../etc": { get: { operationId: "escape" } },
      "/safe": { get: { operationId: "safe" } },
    },
  };
  const { connector, warnings } = compileOpenApiSpec(JSON.stringify(spec), { slug: "safe" });
  assert.deepEqual(connector.actions.map((action) => action.name), ["safe.safe"]);
  assert.ok(warnings.some((warning) => warning.includes("path traversal")));
});

test("rejects malformed and unsupported documents", () => {
  expectImportError(() => compileOpenApiSpec("   ", { slug: "empty" }), "empty_spec");
  expectImportError(
    () => compileOpenApiSpec("{not json", { slug: "broken" }),
    "invalid_spec",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ swagger: "2.0", info: {}, paths: {} }), { slug: "swagger" }),
    "swagger_unsupported",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ openapi: "2.0.0", info: {} }), { slug: "old" }),
    "openapi_required",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ openapi: "3.0.0", info: {} }), { slug: "paths" }),
    "paths_required",
  );
  expectImportError(() => compileOpenApiSpec(JSON.stringify(mainSpec), { slug: "!" }), "invalid_slug");
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(mainSpec), { slug: "slack" }),
    "slug_taken",
    /built-in connector/,
  );
});

test("rejects unsafe or incomplete servers", () => {
  const base = {
    openapi: "3.0.0",
    info: { title: "Server rules" },
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ ...base, servers: [{ url: "/relative" }] }), { slug: "rel" }),
    "invalid_server_url",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ ...base, servers: [{ url: "http://plain.example" }] }), { slug: "plain" }),
    "insecure_server",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify({ ...base, servers: [{ url: "https://{region}.example.com" }] }), { slug: "missing-var" }),
    "server_variable",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(base), { slug: "noserver" }),
    "servers_required",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(base), { slug: "private", baseUrl: "https://127.0.0.1" }),
    "invalid_base_url",
    /private/,
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(base), { slug: "plain-override", baseUrl: "http://override.example" }),
    "invalid_base_url",
    /HTTPS/,
  );
});

test("rejects auth configurations the proxy cannot inject", () => {
  const oauthSpec = {
    openapi: "3.0.0",
    info: { title: "OAuth only" },
    servers: [{ url: "https://oauth.example" }],
    components: { securitySchemes: { oauth: { type: "oauth2", flows: {} } } },
    security: [{ oauth: [] }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  expectImportError(() => compileOpenApiSpec(JSON.stringify(oauthSpec), { slug: "oauth" }), "oauth_not_supported");

  const digestSpec = {
    openapi: "3.0.0",
    info: { title: "Digest" },
    servers: [{ url: "https://digest.example" }],
    components: { securitySchemes: { digest: { type: "http", scheme: "digest" } } },
    security: [{ digest: [] }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(digestSpec), { slug: "digest", authScheme: "digest" }),
    "unsupported_auth",
  );
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(digestSpec), { slug: "digest", authScheme: "missing" }),
    "unknown_auth_scheme",
  );

  const noAuth = {
    openapi: "3.0.0",
    info: { title: "No auth" },
    servers: [{ url: "https://none.example" }],
    paths: { "/ping": { get: { operationId: "ping" } } },
  };
  expectImportError(() => compileOpenApiSpec(JSON.stringify(noAuth), { slug: "none" }), "auth_required");
});

test("reports no_actions with the reason when every operation is filtered", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Header only" },
    servers: [{ url: "https://headers.example" }],
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    security: [{ key: [] }],
    paths: {
      "/ping": {
        get: {
          operationId: "ping",
          parameters: [{ name: "X-Trace", in: "header", required: true }],
        },
      },
    },
  };
  expectImportError(
    () => compileOpenApiSpec(JSON.stringify(spec), { slug: "headers" }),
    "no_actions",
    /required header or cookie/,
  );
});

test("slugify produces connector-safe slugs", () => {
  assert.equal(slugify("My API!!"), "my-api");
  assert.equal(slugify("  Acme__Records  "), "acme-records");
  assert.equal(slugify("a".repeat(80)).length, 40);
});
