import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  verify as cryptoVerify,
  createPublicKey,
} from "node:crypto";
import { masterKeyBytes, jwtPrivateKeyDer } from "./secrets";
import { db } from "./db";

const VERSION = "v1";

export function newId(prefix = "") {
  return `${prefix}${randomUUID().replace(/-/g, "")}`;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/* ------------------------------------------------------------------ */
/* Envelope encryption (AES-256-GCM)                                   */
/* ------------------------------------------------------------------ */

export function seal(key: Buffer, plaintext: string | Buffer, aad = "keel") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function open(key: Buffer, payload: string, aad = "keel") {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) throw new Error("Invalid ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function wrapKey(key: Buffer) {
  return seal(masterKeyBytes(), key, "keel:key-wrap");
}

export function unwrapKey(payload: string) {
  return Buffer.from(open(masterKeyBytes(), payload, "keel:key-wrap"), "utf8");
}

async function projectKey(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found");
  if (!project.keyEncrypted) {
    const key = randomBytes(32);
    const wrapped = seal(masterKeyBytes(), key.toString("base64"), `keel:project:${projectId}`);
    await db.project.update({ where: { id: projectId }, data: { keyEncrypted: wrapped } });
    return key;
  }
  return Buffer.from(open(masterKeyBytes(), project.keyEncrypted, `keel:project:${projectId}`), "base64");
}

export async function encryptSecret(projectId: string, secret: unknown) {
  const key = await projectKey(projectId);
  const dataKey = randomBytes(32);
  const encryptedPayload = seal(dataKey, JSON.stringify(secret), `keel:credential:${projectId}`);
  const dataKeyEncrypted = seal(key, dataKey.toString("base64"), `keel:dek:${projectId}`);
  return { encryptedPayload, dataKeyEncrypted };
}

export async function decryptSecret(
  projectId: string,
  encryptedPayload: string,
  dataKeyEncrypted: string,
) {
  const key = await projectKey(projectId);
  const dataKey = Buffer.from(
    open(key, dataKeyEncrypted, `keel:dek:${projectId}`),
    "base64",
  );
  return JSON.parse(open(dataKey, encryptedPayload, `keel:credential:${projectId}`));
}

/* ------------------------------------------------------------------ */
/* Agent identity (Ed25519)                                            */
/* ------------------------------------------------------------------ */

export function generateAgentIdentity() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    publicKey,
    privateKey,
    fingerprint: sha256(Buffer.from(der)),
  };
}

export function fingerprintFor(publicKeyPem: string) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return sha256(Buffer.from(der));
}

export function verifyAgentSignature(publicKeyPem: string, message: string, signatureB64: string) {
  try {
    return cryptoVerify(
      null,
      Buffer.from(message, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

export function formatFingerprint(fingerprint: string) {
  if (!fingerprint) return "";
  return `kf_${fingerprint.slice(0, 4)} ${fingerprint.slice(4, 12)} ${fingerprint.slice(12, 20)} ${fingerprint.slice(20, 28)}`;
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

const ENV_PREFIX: Record<string, string> = { development: "dev", production: "prod" };

export function generateApiKey(environmentType: string, type: "secret" | "publishable") {
  const prefix = type === "secret" ? "sk" : "pk";
  const env = ENV_PREFIX[environmentType] ?? environmentType;
  const full = `${prefix}_${env}_${randomToken(24)}`;
  return {
    key: full,
    keyHash: sha256(full),
    prefix: `${full.slice(0, 12)}…${full.slice(-4)}`,
  };
}

export function apiKeyLookup(key: string) {
  return sha256(key.trim());
}

/* ------------------------------------------------------------------ */
/* Signed links                                                        */
/* ------------------------------------------------------------------ */

export function signedLinkToken(parts: string[]) {
  const payload = parts.join(".");
  return `${payload}.${sha256(`${payload}:${Buffer.from(masterKeyBytes()).toString("hex")}`).slice(0, 32)}`;
}

export function verifySignedLinkToken(token: string) {
  const segments = token.split(".");
  if (segments.length < 2) return null;
  const signature = segments.pop()!;
  const payload = segments.join(".");
  const expected = sha256(`${payload}:${Buffer.from(masterKeyBytes()).toString("hex")}`).slice(0, 32);
  return constantTimeEqual(signature, expected) ? payload : null;
}

export { jwtPrivateKeyDer };
