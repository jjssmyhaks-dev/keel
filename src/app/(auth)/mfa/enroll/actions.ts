"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { auditHuman } from "@/lib/human-audit";
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  unpackMfaSecret,
  verifySecondFactor,
  verifyTotpCode,
} from "@/lib/mfa";

export type EnrollState = { error?: string; codes?: string[] };

async function currentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.deletedAt) return null;
  return { session, user };
}

async function requestIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

export async function confirmMfaEnrollmentAction(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const current = await currentUser();
  if (!current) return { error: "Your session expired. Sign in again." };
  const { session, user } = current;
  if (user.twoFactorEnabledAt) return { error: "Two-factor authentication is already enabled." };
  if (!user.twoFactorSecret || !user.twoFactorDataKey) {
    return { error: "Reload this page to generate a new secret before confirming." };
  }

  const ip = await requestIp();
  const limit = await consumeRateLimit(`mfa-enroll:${user.id}`, 10, 10 * 60_000);
  if (!limit.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const code = String(formData.get("code") || "").trim();
  const secret = unpackMfaSecret(user.twoFactorSecret, user.twoFactorDataKey, user.id);
  const result = verifyTotpCode(secret, code);
  if (!result.ok) {
    return { error: "That code is not valid yet. Check your authenticator and try again." };
  }
  try {
    await db.mfaUse.create({ data: { key: `${user.id}:${result.step}`, userId: user.id } });
  } catch {
    return { error: "That code was already used. Wait for the next code." };
  }

  const codes = generateRecoveryCodes();
  await db.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabledAt: new Date(),
      mfaRecoveryCodesJson: hashRecoveryCodes(codes),
    },
  });
  await db.session.update({
    where: { id: session.session.id },
    data: { mfaVerifiedAt: new Date() },
  });
  await auditHuman({
    userId: user.id,
    actorName: user.name,
    action: "auth.mfa_enabled",
    outcome: "allowed",
    ip,
    payload: { method: "totp", recoveryCodes: codes.length },
  });
  return { codes };
}

export async function disableMfaAction(_prev: EnrollState, formData: FormData): Promise<EnrollState> {
  const current = await currentUser();
  if (!current) return { error: "Your session expired. Sign in again." };
  const { user } = current;
  if (!user.twoFactorEnabledAt) return { error: "Two-factor authentication is not enabled." };

  const requiredByOrg = await db.membership.count({
    where: { userId: user.id, status: "active", org: { requireMfa: true, deletedAt: null } },
  });
  if (requiredByOrg > 0) {
    return { error: "Your organization requires MFA. An owner or admin must change that policy first." };
  }

  const ip = await requestIp();
  const limit = await consumeRateLimit(`mfa-enroll:${user.id}`, 10, 10 * 60_000);
  if (!limit.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const code = String(formData.get("code") || "").trim();
  const result = await verifySecondFactor(user, code);
  if (!result.ok) return { error: "That code is not valid. Check your authenticator and try again." };

  await db.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      twoFactorDataKey: null,
      mfaRecoveryCodesJson: "[]",
    },
  });
  await auditHuman({
    userId: user.id,
    actorName: user.name,
    action: "auth.mfa_disabled",
    outcome: "recorded",
    ip,
    payload: { method: result.method },
  });
  redirect("/app/settings?mfa=disabled");
}

export async function regenerateRecoveryCodesAction(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const current = await currentUser();
  if (!current) return { error: "Your session expired. Sign in again." };
  const { user } = current;
  if (!user.twoFactorEnabledAt) return { error: "Two-factor authentication is not enabled." };

  const ip = await requestIp();
  const limit = await consumeRateLimit(`mfa-enroll:${user.id}`, 10, 10 * 60_000);
  if (!limit.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const code = String(formData.get("code") || "").trim();
  const result = await verifySecondFactor(user, code);
  if (!result.ok) return { error: "That code is not valid. Check your authenticator and try again." };

  const codes = generateRecoveryCodes();
  await db.user.update({
    where: { id: user.id },
    data: { mfaRecoveryCodesJson: hashRecoveryCodes(codes) },
  });
  await auditHuman({
    userId: user.id,
    actorName: user.name,
    action: "auth.mfa_recovery_regenerated",
    outcome: "recorded",
    ip,
    payload: { count: codes.length },
  });
  return { codes };
}
