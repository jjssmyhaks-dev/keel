import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";

export interface SignedChallenge {
  challenge: string;
  signature: string;
}

/**
 * Build and sign the challenge required to issue a token for a
 * client-key-mode agent. The signed message is `${agentId}.${challenge}`.
 */
export function signChallenge(agentId: string, privateKeyPem: string, challenge?: string): SignedChallenge {
  if (!agentId) throw new Error("agentId is required to sign a challenge.");
  const value = challenge ?? `${Math.floor(Date.now() / 1000)}.${randomUUID()}`;
  const key = createPrivateKey(normalizePem(privateKeyPem));
  const signature = sign(null, Buffer.from(`${agentId}.${value}`, "utf8"), key).toString("base64");
  return { challenge: value, signature };
}

export function generateAgentKeypair() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    publicKey,
    privateKey,
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

function normalizePem(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN")) return trimmed;
  const lines = trimmed.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}
