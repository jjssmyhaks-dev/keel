import assert from "node:assert/strict";
import test from "node:test";
import { providerAuthFailure } from "../src/lib/provider-health";

test("Slack authentication errors are detected despite HTTP 200", () => {
  for (const code of ["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]) {
    assert.equal(providerAuthFailure("slack", { ok: false, error: code }), code);
  }
});

test("Slack non-auth errors do not mark the credential broken", () => {
  for (const code of ["missing_scope", "channel_not_found", "ratelimited", "not_in_channel"]) {
    assert.equal(providerAuthFailure("slack", { ok: false, error: code }), null);
  }
  assert.equal(providerAuthFailure("slack", { ok: true }), null);
});

test("other connectors and malformed responses are ignored", () => {
  assert.equal(providerAuthFailure("github", { ok: false, error: "invalid_auth" }), null);
  assert.equal(providerAuthFailure("slack", null), null);
  assert.equal(providerAuthFailure("slack", "invalid_auth"), null);
  assert.equal(providerAuthFailure("slack", { ok: false }), null);
  assert.equal(providerAuthFailure("slack", { ok: false, error: 401 }), null);
});
