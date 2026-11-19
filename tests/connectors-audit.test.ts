import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTORS, connector, actionFor, SANDBOX_CONNECTOR } from "../src/lib/connectors";

test("Connectors: all 31 catalog entries resolve by slug", () => {
  assert.equal(CONNECTORS.length, 31);
  for (const c of CONNECTORS) {
    const found = connector(c.slug);
    assert.ok(found, `Connector ${c.slug} must be found via connector()`);
    assert.equal(found.slug, c.slug);
  }
});

test("Connectors: all 301 actions resolve via actionFor() and have valid schemas", () => {
  let totalActions = 0;
  for (const c of CONNECTORS) {
    for (const action of c.actions) {
      totalActions++;
      const resolved = actionFor(c.slug, action.name);
      assert.ok(resolved, `Action ${action.name} in connector ${c.slug} must resolve via actionFor()`);
      assert.equal(resolved.name, action.name);
      assert.ok(
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(resolved.method),
        `Action ${action.name} has invalid HTTP method ${resolved.method}`
      );
      assert.ok(
        ["read", "write", "destructive", "financial", "admin"].includes(resolved.risk),
        `Action ${action.name} has invalid risk ${resolved.risk}`
      );
      assert.ok(
        resolved.sample !== undefined && resolved.sample !== null,
        `Action ${action.name} must provide a non-null sample response`
      );
    }
  }
  assert.equal(totalActions, 301);
});

test("Connectors: hosts whitelist is clean, strictly domain-based and non-empty", () => {
  for (const c of CONNECTORS) {
    assert.ok(c.hosts.length > 0, `Connector ${c.slug} must declare at least one host`);
    for (const host of c.hosts) {
      assert.ok(!host.includes("://"), `Host ${host} in ${c.slug} must not contain a protocol scheme`);
      assert.ok(!host.includes("/"), `Host ${host} in ${c.slug} must not contain a path`);
      assert.ok(!host.includes(":"), `Host ${host} in ${c.slug} must not contain a port`);
      assert.match(
        host,
        /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
        `Host ${host} in ${c.slug} must be a valid domain or wildcard domain`
      );
    }
  }
});

test("Connectors: credential injection patterns are valid and complete", () => {
  for (const c of CONNECTORS) {
    assert.ok(c.injection, `Connector ${c.slug} must declare injection settings`);
    assert.ok(
      ["header", "query"].includes(c.injection.type),
      `Connector ${c.slug} has invalid injection type ${c.injection.type}`
    );
    assert.ok(c.injection.name, `Connector ${c.slug} must specify an injection parameter name`);

    // Basic auth connectors must declare usernameField
    if (c.injection.basic) {
      assert.ok(
        c.injection.basic.usernameField,
        `Connector ${c.slug} has basic auth but lacks usernameField`
      );
    }
  }
});

test("Connectors: mandatory secret redaction fields are present", () => {
  for (const c of CONNECTORS) {
    assert.ok(
      Array.isArray(c.redactedFields) && c.redactedFields.length > 0,
      `Connector ${c.slug} must specify redactedFields`
    );
    // Every connector must redact its primary authorization / token key
    const fields = c.redactedFields.map((f) => f.toLowerCase());
    const hasAuthRedaction = fields.some((f) =>
      ["authorization", "token", "key", "secret", "password", "apikey"].some((term) =>
        f.includes(term)
      )
    );
    assert.ok(
      hasAuthRedaction,
      `Connector ${c.slug} redactedFields must cover authentication credentials`
    );
  }
});

test("Connectors: sandbox provider is isolated from the public catalogue", () => {
  assert.equal(SANDBOX_CONNECTOR.slug, "sandbox");
  assert.equal(SANDBOX_CONNECTOR.sandbox, true);
  assert.equal(SANDBOX_CONNECTOR.hosts.length, 0);
  assert.equal(
    CONNECTORS.some((c) => c.slug === "sandbox"),
    false,
    "Sandbox connector must never be exposed as an external provider"
  );
  assert.equal(SANDBOX_CONNECTOR.actions.length, 5);
});
