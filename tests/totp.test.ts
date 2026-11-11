import assert from "node:assert/strict";
import test from "node:test";
import { hotp, verifyTotpCode, totpUri, generateTotpSecret, base32Decode } from "../src/lib/totp";

// RFC 6238 SHA-1 test vectors, secret "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("HOTP matches RFC 6238 SHA-1 vectors", () => {
  assert.equal(hotp(RFC_SECRET, 1, 8), "94287082");
  assert.equal(hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(hotp(RFC_SECRET, Math.floor(1111111111 / 30), 8), "14050471");
  assert.equal(hotp(RFC_SECRET, Math.floor(1234567890 / 30), 8), "89005924");
  assert.equal(hotp(RFC_SECRET, Math.floor(2000000000 / 30), 8), "69279037");
  assert.equal(hotp(RFC_SECRET, Math.floor(20000000000 / 30), 8), "65353130");
});

test("TOTP accepts one step of clock drift in either direction", () => {
  const at = 1_700_000_000_000;
  const step = Math.floor(at / 30_000);
  const previous = hotp(RFC_SECRET, step - 1);
  const current = hotp(RFC_SECRET, step);
  const next = hotp(RFC_SECRET, step + 1);
  const tooOld = hotp(RFC_SECRET, step - 2);

  assert.equal(verifyTotpCode(RFC_SECRET, previous, at).ok, true);
  assert.equal(verifyTotpCode(RFC_SECRET, current, at).ok, true);
  assert.equal(verifyTotpCode(RFC_SECRET, next, at).ok, true);
  assert.equal(verifyTotpCode(RFC_SECRET, tooOld, at).ok, false);
});

test("TOTP rejects malformed and wrong codes", () => {
  const at = 1_700_000_000_000;
  assert.equal(verifyTotpCode(RFC_SECRET, "12345", at).ok, false);
  assert.equal(verifyTotpCode(RFC_SECRET, "abcdef", at).ok, false);
  assert.equal(verifyTotpCode(RFC_SECRET, "000000", at).ok, false);
});

test("generated secrets are 160-bit base32", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret).length, 20);
  assert.notEqual(generateTotpSecret(), secret);
});

test("otpauth URI carries issuer, algorithm and period", () => {
  const uri = totpUri({ secret: RFC_SECRET, email: "ops@example.com" });
  assert.match(uri, /^otpauth:\/\/totp\/Authab%3Aops%40example\.com\?/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
  assert.match(uri, new RegExp(`secret=${RFC_SECRET}`));
});
