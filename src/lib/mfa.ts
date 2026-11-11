import { randomBytes } from "node:crypto";
import { db } from "./db";
import { open, randomToken, seal, sha256, unwrapKey, wrapKey } from "./crypto";
import { base32Encode, generateTotpSecret, totpUri, verifyTotpCode } from "./totp";

export { generateTotpSecret, totpUri, verifyTotpCode };

export function packMfaSecret(secret: string, userId: string) {
  const dataKey = randomBytes(32);
  return {
    twoFactorSecret: seal(dataKey, secret, `authab:mfa:${userId}`),
    twoFactorDataKey: wrapKey(dataKey),
  };
}

export function unpackMfaSecret(secretEncrypted: string, dataKeyEncrypted: string, userId: string) {
  const key = unwrapKey(dataKeyEncrypted);
  return open(key, secretEncrypted, `authab:mfa:${userId}`);
}

export function generateRecoveryCodes(count = 10) {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = base32Encode(randomBytes(8)).slice(0, 10).toLowerCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function hashRecoveryCodes(codes: string[]) {
  return JSON.stringify(codes.map((code) => sha256(code.replace(/[\s-]/g, "").toLowerCase())));
}

export async function consumeRecoveryCode(userId: string, code: string) {
  const normalized = code.replace(/[\s-]/g, "").toLowerCase();
  if (normalized.length < 8) return false;
  const codeHash = sha256(normalized);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ mfaRecoveryCodesJson: string }[]>`
      SELECT "mfaRecoveryCodesJson" FROM "User" WHERE id = ${userId} FOR UPDATE
    `;
    const current = rows[0]?.mfaRecoveryCodesJson;
    if (!current) return false;
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(current) as string[];
    } catch {
      return false;
    }
    const index = hashes.indexOf(codeHash);
    if (index === -1) return false;
    hashes.splice(index, 1);
    await tx.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodesJson: JSON.stringify(hashes) },
    });
    return true;
  });
}

export async function verifySecondFactor(user: {
  id: string;
  twoFactorSecret: string | null;
  twoFactorDataKey: string | null;
  twoFactorEnabledAt: Date | null;
}, code: string) {
  if (!user.twoFactorEnabledAt) return { ok: false as const, reason: "not_enrolled" as const };
  const normalized = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(normalized)) {
    if (!user.twoFactorSecret || !user.twoFactorDataKey) {
      return { ok: false as const, reason: "not_enrolled" as const };
    }
    const secret = unpackMfaSecret(user.twoFactorSecret, user.twoFactorDataKey, user.id);
    const result = verifyTotpCode(secret, normalized);
    if (!result.ok) return { ok: false as const, reason: "invalid" as const };
    const claimed = await db.mfaUse.createMany({
      data: [{ key: `${user.id}:${result.step}`, userId: user.id }],
      skipDuplicates: true,
    });
    if (claimed.count !== 1) return { ok: false as const, reason: "replayed" as const };
    return { ok: true as const, method: "totp" as const };
  }
  if (await consumeRecoveryCode(user.id, code)) {
    return { ok: true as const, method: "recovery" as const };
  }
  return { ok: false as const, reason: "invalid" as const };
}

export async function mfaRequiredForUser(userId: string, enabledAt: Date | null) {
  if (enabledAt) return { required: true as const, enrolled: true };
  const memberships = await db.membership.findMany({
    where: { userId, status: "active", org: { requireMfa: true, deletedAt: null } },
    select: { id: true },
    take: 1,
  });
  return { required: memberships.length > 0, enrolled: false as const };
}

export async function issueMfaChallenge(
  userId: string,
  email: string,
  next: string,
  context?: { authMethod?: string; ssoConnectionId?: string },
) {
  const token = randomToken(32);
  await db.loginToken.create({
    data: {
      tokenHash: sha256(token),
      type: "mfa_challenge",
      email,
      userId,
      metaJson: JSON.stringify({
        next,
        authMethod: context?.authMethod ?? "password",
        ssoConnectionId: context?.ssoConnectionId ?? null,
      }),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  return token;
}
