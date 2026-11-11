import assert from "node:assert/strict";
import test from "node:test";
import { redact, redactedFieldNames, redactDeep, secretValues } from "../src/lib/redaction";

test("redactedFieldNames matches connector fields and credential-like keys at any depth", () => {
  const input = {
    channel: "#ops",
    api_key: "x",
    token: "y",
    Authorization: "z",
    note: "hello",
    nested: { variables: { apiKey: "nested" } },
  };
  assert.deepEqual(redactedFieldNames(input, ["channel"]), [
    "channel",
    "api_key",
    "token",
    "Authorization",
    "nested.variables.apiKey",
  ]);
  assert.deepEqual(redactedFieldNames(input, []), ["api_key", "token", "Authorization", "nested.variables.apiKey"]);
  assert.deepEqual(redactedFieldNames({ note: "hello", count: 2 }, []), []);
  assert.deepEqual(redactedFieldNames({ rows: [{ password: "a" }, { password: "b" }] }, []), ["rows.password"]);
});

test("redact replaces matching values at any depth without mutating the input", () => {
  const input = {
    channel: "#ops",
    password: "hunter2",
    nested: { token: "abc", label: "keep" },
    list: [{ secret: "value" }, "plain"],
  };
  const out = redact(input, []);
  assert.deepEqual(out, {
    channel: "#ops",
    password: "[redacted]",
    nested: { token: "[redacted]", label: "keep" },
    list: [{ secret: "[redacted]" }, "plain"],
  });
  assert.equal(input.password, "hunter2");
  assert.equal(input.nested.token, "abc");
});

test("secretValues only collects plausible credential strings", () => {
  const secret = {
    token: "trust-check-token-9f3b2c7d1e",
    apiKey: "sk_live_abcdef",
    note: "short",
    username: "operations-user",
    password: "correct-horse",
  };
  const values = secretValues(secret);
  assert.ok(values.includes("trust-check-token-9f3b2c7d1e"));
  assert.ok(values.includes("sk_live_abcdef"));
  assert.ok(values.includes("correct-horse"));
  assert.equal(values.includes("short"), false, "values under 8 characters are ignored");
  assert.equal(values.includes("operations-user"), false, "non-sensitive keys need an explicit extra key");
  assert.equal(secretValues(secret, ["username"]).includes("operations-user"), true);
});

test("secretValues orders longest first so substr secrets cannot leave fragments", () => {
  const values = secretValues({ token: "abcdefgh", secret: "abcdefghijkl" });
  assert.deepEqual(values, ["abcdefghijkl", "abcdefgh"]);
});

test("redactDeep replaces echoed credentials in nested responses and counts hits", () => {
  const secret = "trust-check-token-9f3b2c7d1e";
  const response = {
    headers: { Authorization: `Bearer ${secret}` },
    echoed: [{ value: secret }],
    plain: "no secret here",
    count: 2,
    ok: true,
    empty: null,
  };
  const { value, hits } = redactDeep(response, [secret]);
  assert.equal(hits, 2);
  assert.equal((value as typeof response).headers.Authorization, "Bearer [redacted]");
  assert.equal((value as typeof response).echoed[0].value, "[redacted]");
  assert.equal((value as typeof response).plain, "no secret here");
  assert.equal((value as typeof response).count, 2);
  assert.equal((value as typeof response).ok, true);
  assert.equal((value as typeof response).empty, null);
});

test("redactDeep is a no-op without secrets", () => {
  const response = { token: "still-there" };
  const result = redactDeep(response, []);
  assert.deepEqual(result, { value: response, hits: 0 });
});
