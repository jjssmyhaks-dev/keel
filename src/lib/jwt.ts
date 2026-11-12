import { importPKCS8, exportJWK, SignJWT, jwtVerify, decodeJwt, type JWK } from "jose";
import { createPublicKey } from "node:crypto";
import { jwtPrivateKeyDer } from "./secrets";
import { newId } from "./crypto";

const ISSUER = process.env.JWT_ISSUER || "https://authab.dev";
const AUDIENCE = process.env.JWT_AUDIENCE || "authab-api";

const globalForJwt = globalThis as unknown as {
  authabSignKey?: Awaited<ReturnType<typeof importPKCS8>>;
  authabJwks?: { keys: JWK[]; kid: string };
  authabPreviousJwks?: JWK[];
};

/**
 * Retired public keys stay published so documents signed before a rotation
 * still verify. The operator adds the outgoing public JWK to
 * AUTHAB_JWKS_PREVIOUS before changing JWT_SIGNING_PRIVATE_KEY.
 */
function previousJwks(): JWK[] {
  if (globalForJwt.authabPreviousJwks) return globalForJwt.authabPreviousJwks;
  const raw = process.env.AUTHAB_JWKS_PREVIOUS?.trim();
  if (!raw) {
    globalForJwt.authabPreviousJwks = [];
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("AUTHAB_JWKS_PREVIOUS must be a JSON array of public JWKs.");
    const keys = parsed
      .filter(
        (entry): entry is JWK =>
          Boolean(entry) && typeof entry === "object" && (entry as JWK).kty === "OKP" && typeof (entry as JWK).x === "string",
      )
      .map((entry) => ({
        ...entry,
        kid: entry.kid ?? String(entry.x).slice(0, 16),
        use: entry.use ?? "sig",
        alg: entry.alg ?? "EdDSA",
      }));
    globalForJwt.authabPreviousJwks = keys;
    return keys;
  } catch (error) {
    console.error("[authab] AUTHAB_JWKS_PREVIOUS is not valid JSON; retired keys are not published.", error);
    globalForJwt.authabPreviousJwks = [];
    return [];
  }
}

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
  return { keys: [...keys, ...previousJwks()] };
}

export async function getSigningKeyId() {
  const { kid } = await jwks();
  return kid;
}

/** Sign an arbitrary platform document as a compact JWS with the platform key. */
export async function signPlatformJws(payload: Record<string, unknown>, typ: string) {
  const key = await signingKey();
  const kid = await getSigningKeyId();
  return new SignJWT(payload).setProtectedHeader({ alg: "EdDSA", kid, typ }).sign(key);
}

export async function verifyPlatformJws(token: string) {
  const { keys } = await getJwks();
  const { importJWK } = await import("jose");
  for (const jwk of keys) {
    try {
      const key = await importJWK(jwk, "EdDSA");
      return await jwtVerify(token, key, { issuer: ISSUER, algorithms: ["EdDSA"] });
    } catch {
      // Try the next published key; a retired key may be the signer.
    }
  }
  throw new Error("The document was not signed by a published platform key.");
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

export type SignAgentTokenOptions = {
  audience?: string;
  cnf?: { jkt: string } | null;
  actor?: Record<string, unknown> | null;
  clientId?: string | null;
  parentJti?: string | null;
  parentChain?: string[];
  delegationId?: string | null;
  scopeEnforced?: boolean;
};

export async function signAgentToken(
  claims: AgentTokenClaims,
  ttlSeconds = 300,
  options: SignAgentTokenOptions = {},
) {
  const key = await signingKey();
  const { kid } = await jwks();
  const jti = newId("tok_");
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    env: claims.environmentId,
    project: claims.projectId,
    org: claims.organizationId,
    principal: claims.principalId ?? null,
    scopes: claims.scopes,
    chain: claims.chain ?? [],
    token_use: "access",
    actor:
      options.actor ??
      (claims.principalId
        ? { sub: claims.agentId, act: claims.principalId }
        : { sub: claims.agentId }),
  };
  if (options.cnf) payload.cnf = options.cnf;
  if (options.clientId) payload.client_id = options.clientId;
  if (options.parentJti) payload.parent_jti = options.parentJti;
  if (options.parentChain?.length) payload.parent_chain = options.parentChain;
  if (options.delegationId) payload.delegation_id = options.delegationId;
  if (options.scopeEnforced) payload.scope_enforced = true;

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
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
  const { keys } = await getJwks();
  const { importJWK } = await import("jose");
  let lastError: unknown = null;
  for (const publicKey of keys) {
    try {
      const key = await importJWK(publicKey, "EdDSA");
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["EdDSA"],
      });
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No platform key could verify this token.");
}

export function decodeAgentToken(token: string) {
  try {
    return decodeJwt(token);
  } catch {
    return null;
  }
}

export { ISSUER, AUDIENCE };
