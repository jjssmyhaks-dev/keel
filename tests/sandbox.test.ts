import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTORS, SANDBOX_CONNECTOR } from "../src/lib/connectors";
import { SANDBOX_SAMPLE_APPS } from "../src/lib/sandbox-samples";

test("sandbox connector is executable but never listed as a provider", () => {
  assert.equal(SANDBOX_CONNECTOR.slug, "sandbox");
  assert.equal(SANDBOX_CONNECTOR.sandbox, true);
  assert.equal(SANDBOX_CONNECTOR.hosts.length, 0);
  assert.equal(SANDBOX_CONNECTOR.authMethods.length, 0);
  assert.equal(
    CONNECTORS.some((connector) => connector.slug === "sandbox"),
    false,
    "the sandbox must not appear in the public connector catalogue",
  );
});

test("sandbox covers every risk class with a deterministic sample", () => {
  const risks = SANDBOX_CONNECTOR.actions.map((action) => action.risk);
  assert.deepEqual(risks, ["read", "write", "financial", "destructive", "admin"]);
  for (const action of SANDBOX_CONNECTOR.actions) {
    assert.match(action.name, /^sandbox\./);
    assert.ok(action.method, `${action.name} needs an HTTP method for the envelope`);
    assert.ok(action.sample && typeof action.sample === "object", `${action.name} needs a sample response`);
  }
});

test("sandbox scopes cover every action", () => {
  const scopes = new Set(SANDBOX_CONNECTOR.scopes.map((scope) => scope.value));
  for (const action of SANDBOX_CONNECTOR.actions) {
    assert.ok(scopes.has(action.name), `${action.name} must be a declared scope`);
  }
});

test("sample apps reference real sandbox actions", () => {
  const actions = new Set(SANDBOX_CONNECTOR.actions.map((action) => action.name));
  for (const sample of SANDBOX_SAMPLE_APPS) {
    assert.ok(actions.has(sample.action), `${sample.id} references unknown action ${sample.action}`);
    assert.ok(sample.resource, `${sample.id} needs a resource`);
    assert.ok(Object.keys(sample.input).length > 0, `${sample.id} needs sample input`);
  }
});

test("the sandbox redacts secret-shaped input fields", () => {
  const redacted = new Set(SANDBOX_CONNECTOR.redactedFields);
  for (const field of ["token", "authorization", "password", "secret", "card", "number"]) {
    assert.ok(redacted.has(field), `${field} must be redacted before audit storage`);
  }
});
