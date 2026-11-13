import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "../src/lib/openapi";

type Operation = { tags?: string[]; summary?: string; security?: unknown[] };
type Document = {
  paths: Record<string, Record<string, Operation>>;
  tags: { name: string }[];
  components: {
    schemas: Record<string, unknown>;
    parameters: Record<string, unknown>;
  };
};

const document = buildOpenApiDocument() as unknown as Document;

/** Every route.ts directory under src/app/api/v1, with [param] mapped to {param}. */
function routePaths(dir = "src/app/api/v1", prefix = ""): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.replace(/^\[(.+)\]$/, "{$1}");
      paths.push(...routePaths(full, `${prefix}/${segment}`));
    } else if (entry === "route.ts") {
      paths.push(prefix);
    }
  }
  return paths;
}

test("every /api/v1 route appears in the OpenAPI document", () => {
  const missing = routePaths()
    .filter((path) => path !== "/openapi")
    .filter((path) => !(path in document.paths));
  assert.deepEqual(missing, []);
});

test("Part 2 routes are documented with their methods", () => {
  const expected: Record<string, string[]> = {
    "/consent/requests": ["post"],
    "/consent/token": ["post"],
    "/consent/{id}/token": ["post"],
    "/consent/{id}/revoke": ["post"],
    "/end-users": ["get"],
    "/end-users/{externalUserId}": ["get"],
    "/end-users/{externalUserId}/control-link": ["post"],
    "/trust-relationships": ["get", "post"],
    "/trust-relationships/{id}/accept": ["post"],
    "/trust-relationships/{id}/decline": ["post"],
    "/trust-relationships/{id}/revoke": ["post"],
    "/tokens/trust-exchange": ["post"],
    "/config/export": ["get"],
    "/config/apply": ["post"],
  };
  for (const [path, methods] of Object.entries(expected)) {
    const item = document.paths[path];
    assert.ok(item, `${path} is missing`);
    for (const method of methods) {
      assert.ok(item[method], `${method.toUpperCase()} ${path} is missing`);
    }
  }
});

test("every operation carries a declared tag and a summary", () => {
  const tags = new Set(document.tags.map((tag) => tag.name));
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      assert.ok(operation.summary, `${method.toUpperCase()} ${path} has no summary`);
      const operationTags = operation.tags ?? [];
      assert.ok(operationTags.length > 0, `${method.toUpperCase()} ${path} has no tag`);
      for (const tag of operationTags) {
        assert.ok(tags.has(tag), `${method.toUpperCase()} ${path} uses undeclared tag ${tag}`);
      }
    }
  }
});

test("every component reference resolves", () => {
  const refs = new Set(
    JSON.stringify(document).match(/"#\/components\/schemas\/[A-Za-z0-9]+"/g)?.map((ref) => ref.slice(1, -1)) ?? [],
  );
  for (const ref of refs) {
    const name = ref.split("/").pop()!;
    assert.ok(document.components.schemas[name], `${ref} is missing`);
  }
  const parameterRefs =
    JSON.stringify(document).match(/"#\/components\/parameters\/[A-Za-z0-9]+"/g)?.map((ref) => ref.slice(1, -1)) ?? [];
  for (const ref of parameterRefs) {
    const name = ref.split("/").pop()!;
    assert.ok(document.components.parameters[name], `${ref} is missing`);
  }
});

test("trust exchange and the proxy require an agent token, not a secret key", () => {
  const exchange = document.paths["/tokens/trust-exchange"].post;
  assert.deepEqual(exchange.security, [{ bearerAgentToken: [] }]);
  const proxy = document.paths["/proxy/{connector}"].post;
  assert.deepEqual(proxy.security, [{ bearerAgentToken: [] }]);
});

test("consent and config mutations document their failure modes", () => {
  const requests = document.paths["/consent/requests"].post as unknown as Record<string, unknown>;
  assert.ok(requests.responses);
  const codes = JSON.stringify(requests.responses);
  for (const code of ["agent_required", "redirect_required", "end_user_required", "invalid_expiry"]) {
    assert.match(codes, new RegExp(code));
  }
  const apply = document.paths["/config/apply"].post as unknown as Record<string, unknown>;
  const applyText = JSON.stringify(apply);
  for (const code of ["ambiguous_name", "config_required", "invalid_yaml"]) {
    assert.match(applyText, new RegExp(code));
  }
  assert.match(applyText, /x-authab-confirm/);
});
