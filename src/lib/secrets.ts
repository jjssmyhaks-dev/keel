import { randomBytes } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Local development key bootstrap. In production all three secrets must be
 * supplied through the environment (or a KMS-backed loader); this fallback
 * only exists so a fresh checkout runs without a setup step.
 */
type LocalSecrets = {
  masterKey: string;
  jwtSigningPrivateKey: string;
  cookieSecret: string;
};

const globalForSecrets = globalThis as unknown as { authabSecrets?: LocalSecrets };

function generateLocalSecrets(): LocalSecrets {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.privateKey.export({ type: "pkcs8", format: "der" });
  return {
    masterKey: randomBytes(32).toString("base64"),
    jwtSigningPrivateKey: Buffer.from(der).toString("base64"),
    cookieSecret: randomBytes(32).toString("hex"),
  };
}

function loadLocalSecrets(): LocalSecrets {
  const file = path.join(process.cwd(), ".authab", "dev-secrets.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed?.masterKey && parsed?.jwtSigningPrivateKey && parsed?.cookieSecret) {
      return parsed;
    }
  } catch {
    // fall through and create
  }
  const generated = generateLocalSecrets();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn("[authab] could not persist local development keys", error);
  }
  return generated;
}

export function getSecrets(): LocalSecrets {
  if (globalForSecrets.authabSecrets) return globalForSecrets.authabSecrets;

  const fromEnv = {
    masterKey: process.env.MASTER_KEY,
    jwtSigningPrivateKey: process.env.JWT_SIGNING_PRIVATE_KEY,
    cookieSecret: process.env.AUTH_COOKIE_SECRET,
  };

  const complete = fromEnv.masterKey && fromEnv.jwtSigningPrivateKey && fromEnv.cookieSecret;

  if (!complete && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const explicitLocal = process.env.AUTHAB_DEV_KEY_FALLBACK === "1";
    if (!explicitLocal) {
      throw new Error(
        "[authab] Refusing to start: set MASTER_KEY, JWT_SIGNING_PRIVATE_KEY and AUTH_COOKIE_SECRET. " +
          "Local development files are only used when AUTHAB_DEV_KEY_FALLBACK=1 is explicitly set.",
      );
    }
    console.warn("[authab] Using local development keys because AUTHAB_DEV_KEY_FALLBACK=1. Never do this on a shared deployment.");
  }

  const secrets = complete
    ? (fromEnv as LocalSecrets)
    : loadLocalSecrets();

  globalForSecrets.authabSecrets = secrets;
  return secrets;
}

export function masterKeyBytes(): Buffer {
  const value = getSecrets().masterKey.trim();
  const raw = value.startsWith("base64:") ? value.slice(7) : value;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEY must decode to 32 bytes");
  return key;
}

export function jwtPrivateKeyDer(): Buffer {
  const value = getSecrets().jwtSigningPrivateKey.trim();
  if (value.includes("-----BEGIN")) {
    const body = value
      .replace(/-----BEGIN [^-]+-----/, "")
      .replace(/-----END [^-]+-----/, "")
      .replace(/\s/g, "");
    return Buffer.from(body, "base64");
  }
  return Buffer.from(value.replace(/^base64:/, ""), "base64");
}

export function cookieSecretBytes(): Buffer {
  return Buffer.from(getSecrets().cookieSecret, "utf8");
}
