import { importPKCS8, exportJWK, SignJWT, jwtVerify, decodeJwt, type JWK } from "jose";
import { createPublicKey } from "node:crypto";
import { jwtPrivateKeyDer } from "./secrets";
import { newId } from "./crypto";

const ISSUER = process.env.JWT_ISSUER || "https://authab.dev";
const AUDIENCE = process.env.JWT_AUDIENCE || "authab-api";

const globalForJwt = globalThis as unknown as {
  authabSignKey?: Awaited<ReturnType<typeof importPKCS8>>;
  authabJwks?: { keys: JWK[]; kid: string };
};

async function signingKey() {
  if (!globalForJwt.authabSignKey) {
    const der = jwtPrivateKeyDer();
    const pem = `-----BEGIN PRIVATE KEY-----\n${der
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n")}\n-----END PRIVATE KEY-----`;
    globalForJwt.authabSignKey = await importPKCS8(pem, "EdDSA");
  }
  return globalForJwt.authabSignKey;
}

async function jwks() {
  if (!globalForJwt.authabJwks) {
    const der = jwtPrivateKeyDer();
    const keyObject = await importPKCS8(
      `-----BEGIN PRIVATE KEY-----\n${der
        .toString("base64")
        .match(/.{1,64}/g)!
        .join("\n")}\n-----END PRIVATE KEY-----`,
      "EdDSA",
    );
    const publicKey = createPublicKey(keyObject as never);
    const jwk = await exportJWK(publicKey as never);
    const kid = (jwk.x || "authab").slice(0, 16);
    globalForJwt.authabJwks = {
      keys: [{ ...jwk, kid, use: "sig", alg: "EdDSA" }],
      kid,
    };
  }
  return globalForJwt.authabJwks;
}

export async function getJwks() {
  const { keys } = await jwks();
  return { keys };
}

export type AgentTokenClaims = {
  agentId: string;
  environmentId: string;
  projectId: string;
  organizationId: string;
  principalId?: string | null;
  scopes: string[];
  chain?: { agentId: string; name: string }[];
  requestId?: string;
};

export async function signAgentToken(claims: AgentTokenClaims, ttlSeconds = 300) {
  const key = await signingKey();
  const { kid } = await jwks();
  const jti = newId("tok_");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    env: claims.environmentId,
    project: claims.projectId,
    org: claims.organizationId,
    principal: claims.principalId ?? null,
    scopes: claims.scopes,
    chain: claims.chain ?? [],
    actor: claims.principalId
      ? { sub: claims.agentId, act: claims.principalId }
      : { sub: claims.agentId },
  })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.agentId)
    .setJti(jti)
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
  return {
    token,
    tokenId: jti,
    expiresIn: ttlSeconds,
    expiresAt: new Date((now + ttlSeconds) * 1000).toISOString(),
  };
}

export async function verifyAgentToken(token: string) {
  const { keys } = await jwks();
  const publicKey = keys[0];
  const { importJWK } = await import("jose");
  const key = await importJWK(publicKey, "EdDSA");
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["EdDSA"],
  });
  return payload;
}

export function decodeAgentToken(token: string) {
  try {
    return decodeJwt(token);
  } catch {
    return null;
  }
}

export { ISSUER, AUDIENCE };
