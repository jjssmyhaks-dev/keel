import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { DpopError, htuMatches, jwkThumbprint, verifyDpopProof } from "../src/lib/dpop";

type Pair = { privateKey: KeyObject; publicJwk: Record<string, unknown> };

function ecPair(): Pair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, publicJwk: publicKey.export({ format: "jwk" }) };
}

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

const REQUEST_URL = "https://api.authab.test/v1/records";

function proofFor(
  pair: Pair,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const encodedHeader = b64url(
    JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: pair.publicJwk, ...header }),
  );
  const encodedClaims = b64url(
    JSON.stringify({
      htm: "POST",
      htu: REQUEST_URL,
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      ...claims,
    }),
  );
  const signature = sign("sha256", Buffer.from(`${encodedHeader}.${encodedClaims}`), {
    key: pair.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${encodedHeader}.${encodedClaims}.${b64url(signature)}`;
}

async function expectDpopError(promise: Promise<unknown>, code: string, pattern?: RegExp) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DpopError, `expected DpopError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return;
  }
  assert.fail(`expected DPoP failure with ${code}`);
}

test("verifies a well-formed proof and binds it to the JWK thumbprint", async () => {
  const pair = ecPair();
  const proof = proofFor(pair);
  const verified = await verifyDpopProof({ proof, method: "POST", url: REQUEST_URL, consume: false });
  assert.equal(verified.jkt, jwkThumbprint(pair.publicJwk));
  assert.equal(verified.jti.length > 0, true);
  assert.equal(verified.claims.htm, "POST");
});

test("htu matching ignores query strings and trailing slashes but not paths", () => {
  assert.equal(htuMatches(`${REQUEST_URL}?a=1`, REQUEST_URL), true);
  assert.equal(htuMatches(`${REQUEST_URL}/`, `${REQUEST_URL}?b=2`), true);
  assert.equal(htuMatches("https://API.AUTHAB.TEST/v1/records", REQUEST_URL), true);
  assert.equal(htuMatches("https://api.authab.test/v1/other", REQUEST_URL), false);
  assert.equal(htuMatches("https://api.authab.test:8443/v1/records", REQUEST_URL), false);
  assert.equal(htuMatches("not a url", REQUEST_URL), false);
});

test("rejects a proof with the wrong typ, algorithm, or non-public JWK", async () => {
  const pair = ecPair();
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair, {}, { typ: "JWT" }), method: "POST", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /typ header/,
  );
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair, {}, { alg: "HS256" }), method: "POST", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /not accepted/,
  );
  const jwk = { ...pair.publicJwk, d: "private-material" };
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair, {}, { jwk }), method: "POST", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /public JWK/,
  );
});

test("rejects method, URL, and timestamp mismatches", async () => {
  const pair = ecPair();
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair), method: "GET", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /htm/,
  );
  await expectDpopError(
    verifyDpopProof({
      proof: proofFor(pair, { htu: "https://api.authab.test/v1/other" }),
      method: "POST",
      url: REQUEST_URL,
      consume: false,
    }),
    "invalid_dpop_proof",
    /htu/,
  );
  await expectDpopError(
    verifyDpopProof({
      proof: proofFor(pair, { iat: Math.floor(Date.now() / 1000) - 301 }),
      method: "POST",
      url: REQUEST_URL,
      consume: false,
    }),
    "invalid_dpop_proof",
    /five minutes/,
  );
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair, { jti: "" }), method: "POST", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /jti/,
  );
});

test("rejects tampered signatures and a different key", async () => {
  const pair = ecPair();
  const other = ecPair();
  const proof = proofFor(pair);
  const [header, claims, signature] = proof.split(".");
  const tampered = `${header}.${claims}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  await expectDpopError(
    verifyDpopProof({ proof: tampered, method: "POST", url: REQUEST_URL, consume: false }),
    "invalid_dpop_proof",
    /signature/,
  );
  await expectDpopError(
    verifyDpopProof({
      proof: proofFor(other),
      method: "POST",
      url: REQUEST_URL,
      expectedJkt: jwkThumbprint(pair.publicJwk),
      consume: false,
    }),
    "dpop_key_mismatch",
  );
});

test("checks the ath claim against the presented access token", async () => {
  const pair = ecPair();
  const accessToken = "access-token-123";
  const ath = createHash("sha256").update(accessToken).digest("base64url");
  await expectDpopError(
    verifyDpopProof({ proof: proofFor(pair), method: "POST", url: REQUEST_URL, accessToken, consume: false }),
    "invalid_dpop_proof",
    /ath/,
  );
  const verified = await verifyDpopProof({
    proof: proofFor(pair, { ath }),
    method: "POST",
    url: REQUEST_URL,
    accessToken,
    consume: false,
  });
  assert.equal(verified.claims.ath, ath);
});

test("a proof can be re-verified without replay protection when consume is false", async () => {
  const pair = ecPair();
  const proof = proofFor(pair);
  const first = await verifyDpopProof({ proof, method: "POST", url: REQUEST_URL, consume: false });
  const second = await verifyDpopProof({ proof, method: "POST", url: REQUEST_URL, consume: false });
  assert.equal(first.jkt, second.jkt);
  assert.equal(first.jti, second.jti);
});

test("jwkThumbprint follows RFC 7638 for EC, RSA, and OKP keys", () => {
  const { publicKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaJwk = rsa.export({ format: "jwk" }) as Record<string, unknown>;
  const expected = createHash("sha256")
    .update(JSON.stringify({ e: rsaJwk.e, kty: "RSA", n: rsaJwk.n }))
    .digest("base64url");
  assert.equal(jwkThumbprint(rsaJwk), expected);

  const { publicKey: ed } = generateKeyPairSync("ed25519");
  const edJwk = ed.export({ format: "jwk" }) as Record<string, unknown>;
  assert.equal(edJwk.kty, "OKP");
  assert.equal(jwkThumbprint(edJwk).length, 43);

  assert.throws(() => jwkThumbprint({ kty: "oct", k: "secret" }), DpopError);
  assert.throws(() => jwkThumbprint({ kty: "RSA", n: "abc" }), DpopError);
});
