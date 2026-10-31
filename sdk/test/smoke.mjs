import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import {
  KeelError,
  generateAgentKeypair,
  isKeelError,
  signChallenge,
  verifyWebhook,
} from "../dist/index.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("signChallenge produces a verifiable Ed25519 signature", () => {
  const { publicKey, privateKey } = generateAgentKeypair();
  const signed = signChallenge("agt_test", privateKey);
  assert.match(signed.challenge, /^\d+\.[0-9a-f-]{36}$/);
  assert.equal(
    verify(null, Buffer.from(`agt_test.${signed.challenge}`), publicKey, Buffer.from(signed.signature, "base64")),
    true,
  );
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.equal(
    verify(null, Buffer.from(`agt_test.${signed.challenge}`), other, Buffer.from(signed.signature, "base64")),
    false,
  );
});

test("signChallenge rejects a missing agent id", () => {
  const { privateKey } = generateAgentKeypair();
  assert.throws(() => signChallenge("", privateKey), /agentId is required/);
});

test("verifyWebhook accepts a fresh, correct signature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", event: "approval.requested" });
  const timestamp = 1_790_000_000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(verifyWebhook({ secret, header, body, now: timestamp * 1000 }), true);
});

test("verifyWebhook rejects a tampered body", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_790_000_000;
  const body = JSON.stringify({ id: "evt_1" });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(verifyWebhook({ secret, header, body: `${body} `, now: timestamp * 1000 }), false);
});

test("verifyWebhook rejects a stale timestamp", () => {
  const secret = "whsec_test_secret";
  const body = "{}";
  const timestamp = 1_790_000_000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(verifyWebhook({ secret, header, body, now: timestamp * 1000 + 301_000 }), false);
});

test("verifyWebhook rejects malformed headers", () => {
  const secret = "whsec_test_secret";
  assert.equal(verifyWebhook({ secret, header: "", body: "{}" }), false);
  assert.equal(verifyWebhook({ secret, header: "t=abc,v1=zz", body: "{}" }), false);
  assert.equal(verifyWebhook({ secret, header: "v1=deadbeef", body: "{}" }), false);
});

test("KeelError carries status, code and request id", () => {
  const error = new KeelError({
    status: 403,
    code: "policy_denied",
    message: "Denied by policy.",
    details: { reason: "deny" },
    requestId: "req_123",
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, "policy_denied");
  assert.equal(error.requestId, "req_123");
  assert.deepEqual(error.details, { reason: "deny" });
  assert.equal(isKeelError(error), true);
  assert.equal(isKeelError(new Error("nope")), false);
});

console.log(`\n${passed} checks passed`);
