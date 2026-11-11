import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { signApprovalToken, verifyApprovalLink, approvalUrlFor } from "../src/lib/signed-links";

process.env.MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SIGNING_PRIVATE_KEY = Buffer.alloc(48, 3).toString("base64");
process.env.AUTH_COOKIE_SECRET = "unit-test-cookie-secret";

test("signs an approval token with the version prefix", () => {
  const signed = signApprovalToken("approval_abc123");
  const parts = signed.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "apr1");
  assert.equal(parts[1], "approval_abc123");
  assert.ok(parts[2].length > 0);
});

test("verifies a link it produced", () => {
  const signed = signApprovalToken("approval_roundtrip");
  assert.equal(verifyApprovalLink(signed), "approval_roundtrip");
});

test("signing is deterministic for the same token", () => {
  assert.equal(signApprovalToken("same-token"), signApprovalToken("same-token"));
});

test("rejects a tampered token", () => {
  const signed = signApprovalToken("approval_original");
  const tampered = signed.replace("approval_original", "approval_original2");
  assert.equal(verifyApprovalLink(tampered), null);
});

test("rejects a tampered signature", () => {
  const signed = signApprovalToken("approval_signature");
  const [version, token, signature] = signed.split(".");
  const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
  assert.equal(verifyApprovalLink(`${version}.${token}.${flipped}`), null);
});

test("rejects links signed with a different secret", () => {
  const signed = signApprovalToken("approval_secret");
  const [version, token] = signed.split(".");
  const foreign = createHmac("sha256", "a-different-secret").update(token).digest("base64url");
  assert.equal(verifyApprovalLink(`${version}.${token}.${foreign}`), null);
});

test("rejects unknown versions and malformed links", () => {
  const signed = signApprovalToken("approval_version");
  assert.equal(verifyApprovalLink(signed.replace(/^apr1/, "apr2")), null);
  assert.equal(verifyApprovalLink(""), null);
  assert.equal(verifyApprovalLink("apr1"), null);
  assert.equal(verifyApprovalLink("apr1.token"), null);
  assert.equal(verifyApprovalLink("apr1..signature"), null);
  assert.equal(verifyApprovalLink("apr1.tok.sig.extra"), null);
});

test("builds an approval URL without duplicate slashes", () => {
  process.env.APP_URL = "https://authab.example/";
  const url = approvalUrlFor("approval_url");
  assert.ok(url.startsWith("https://authab.example/approve/apr1.approval_url."));
});
