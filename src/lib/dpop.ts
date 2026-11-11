import { createHash, createPublicKey, constants, verify as verifySignature } from "node:crypto";
import type { JsonWebKey as NodeJsonWebKey } from "node:crypto";
import { db } from "./db";
import { constantTimeEqual, sha256 } from "./crypto";

export class DpopError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const ALGORITHMS = new Set(["ES256", "ES384", "RS256", "PS256", "EdDSA"]);
const MAX_CLOCK_SKEW_SECONDS = 300;

function decodeSegment(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function jwkThumbprint(jwk: Record<string, unknown>) {
  const kty = String(jwk.kty ?? "");
  let canonical: string;
  if (kty === "EC") {
    canonical = JSON.stringify({ crv: jwk.crv, kty, x: jwk.x, y: jwk.y });
  } else if (kty === "RSA") {
    canonical = JSON.stringify({ e: jwk.e, kty, n: jwk.n });
  } else if (kty === "OKP") {
    canonical = JSON.stringify({ crv: jwk.crv, kty, x: jwk.x });
  } else {
    throw new DpopError("dpop_unsupported_key", "DPoP proofs must use an EC, RSA or OKP public key.");
  }
  if (!jwk.x && kty !== "RSA") throw new DpopError("dpop_invalid_key", "The DPoP public key is incomplete.");
  if (kty === "RSA" && (!jwk.n || !jwk.e)) throw new DpopError("dpop_invalid_key", "The DPoP RSA key is incomplete.");
  return createHash("sha256").update(canonical).digest("base64url");
}

function signatureValid(
  alg: string,
  jwk: Record<string, unknown>,
  signingInput: string,
  signature: Buffer,
) {
  let key;
  try {
    key = createPublicKey({ key: jwk as unknown as NodeJsonWebKey, format: "jwk" });
  } catch {
    throw new DpopError("dpop_invalid_key", "The DPoP proof header does not contain a usable public JWK.");
  }
  const data = Buffer.from(signingInput);
  if (alg === "ES256" || alg === "ES384") {
    return verifySignature(
      alg === "ES256" ? "sha256" : "sha384",
      data,
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  }
  if (alg === "RS256") return verifySignature("sha256", data, key, signature);
  if (alg === "PS256") {
    return verifySignature(
      "sha256",
      data,
      { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      signature,
    );
  }
  if (alg === "EdDSA") return verifySignature(null, data, key, signature);
  return false;
}

function normalizeHttpUri(raw: string) {
  const url = new URL(raw);
  return {
    host: url.host.toLowerCase(),
    path: url.pathname.replace(/\/+$/, "") || "/",
  };
}

export function htuMatches(htu: string, requestUrl: string) {
  let actual;
  let expected;
  try {
    actual = normalizeHttpUri(htu);
    expected = normalizeHttpUri(requestUrl);
  } catch {
    return false;
  }
  const appHost = (() => {
    try {
      return process.env.APP_URL ? new URL(process.env.APP_URL).host.toLowerCase() : null;
    } catch {
      return null;
    }
  })();
  const hostOk = actual.host === expected.host || actual.host === appHost;
  return hostOk && actual.path === expected.path;
}

export type VerifiedDpop = {
  jkt: string;
  jti: string;
  claims: Record<string, unknown>;
};

export async function verifyDpopProof(opts: {
  proof: string;
  method: string;
  url: string;
  accessToken?: string;
  expectedJkt?: string;
  consume?: boolean;
}): Promise<VerifiedDpop> {
  const parts = opts.proof.trim().split(".");
  if (parts.length !== 3) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof must be a compact JWT.");
  }

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Buffer;
  try {
    header = JSON.parse(decodeSegment(parts[0]).toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(decodeSegment(parts[1]).toString("utf8")) as Record<string, unknown>;
    signature = decodeSegment(parts[2]);
  } catch {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof is not a valid JWT.");
  }

  if (String(header.typ ?? "").toLowerCase() !== "dpop+jwt") {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof must use the dpop+jwt typ header.");
  }
  const alg = String(header.alg ?? "");
  if (!ALGORITHMS.has(alg)) {
    throw new DpopError("invalid_dpop_proof", `Algorithm “${alg || "none"}” is not accepted for DPoP proofs.`);
  }
  const jwk = header.jwk;
  if (!isRecord(jwk) || jwk.d || jwk.k) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof must embed a public JWK and never private key material.");
  }
  if (!signatureValid(alg, jwk, `${parts[0]}.${parts[1]}`, signature)) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof signature does not verify.");
  }

  const jkt = jwkThumbprint(jwk);
  if (opts.expectedJkt && !constantTimeEqual(jkt, opts.expectedJkt)) {
    throw new DpopError("dpop_key_mismatch", "The DPoP proof key does not match the key this token is bound to.");
  }

  if (String(claims.htm ?? "").toUpperCase() !== opts.method.toUpperCase()) {
    throw new DpopError("invalid_dpop_proof", `The DPoP proof htm claim must be ${opts.method.toUpperCase()}.`);
  }
  if (typeof claims.htu !== "string" || !htuMatches(claims.htu, opts.url)) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof htu claim does not match the request URL.");
  }

  const now = Math.floor(Date.now() / 1000);
  const iat = Number(claims.iat);
  if (!Number.isFinite(iat) || Math.abs(now - iat) > MAX_CLOCK_SKEW_SECONDS) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof iat claim must be within five minutes of now.");
  }

  const jti = typeof claims.jti === "string" ? claims.jti.trim() : "";
  if (!jti || jti.length > 128) {
    throw new DpopError("invalid_dpop_proof", "The DPoP proof needs a jti claim of 1–128 characters.");
  }

  if (opts.accessToken) {
    const expectedAth = createHash("sha256").update(opts.accessToken).digest("base64url");
    if (typeof claims.ath !== "string" || !constantTimeEqual(claims.ath, expectedAth)) {
      throw new DpopError("invalid_dpop_proof", "The DPoP proof ath claim does not hash the presented access token.");
    }
  }

  if (opts.consume !== false) {
    const id = sha256(`${jkt}:${jti}`);
    await db.dpopProofUse.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => null);
    try {
      await db.dpopProofUse.create({
        data: { id, jkt, expiresAt: new Date(Date.now() + MAX_CLOCK_SKEW_SECONDS * 1000) },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new DpopError("dpop_replayed", "This DPoP proof was already used. Sign a fresh proof for every request.");
      }
      throw error;
    }
  }

  return { jkt, jti, claims };
}

export function dpopVerifier(jwk: Record<string, unknown>) {
  return jwkThumbprint(jwk);
}
