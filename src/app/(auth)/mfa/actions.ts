"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { createSession, getSession, setActiveOrg } from "@/lib/session";
import { verifySecondFactor } from "@/lib/mfa";
import { consumeRateLimit } from "@/lib/rate-limit";
import { auditHuman } from "@/lib/human-audit";

export type MfaState = { error?: string };

function safeNext(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export async function verifyMfaChallengeAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const token = String(formData.get("token") || "");
  const code = String(formData.get("code") || "").trim();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

  const record = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (
    !record ||
    record.type !== "mfa_challenge" ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    !record.userId
  ) {
    return { error: "This two-factor challenge expired. Sign in again." };
  }

  const limit = await consumeRateLimit(`mfa:${record.userId}:${ip ?? "unknown"}`, 8, 10 * 60_000);
  if (!limit.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user || user.deletedAt) return { error: "This account is not available." };

  const result = await verifySecondFactor(user, code);
  if (!result.ok) {
    await auditHuman({
      userId: user.id,
      actorName: user.name,
      action: "auth.mfa_failed",
      outcome: "denied",
      ip,
      payload: { reason: result.reason, factor: code.includes("-") ? "recovery" : "totp" },
    });
    return {
      error:
        result.reason === "replayed"
          ? "That code was already used. Wait for the next code."
          : "That code is not valid. Check your authenticator and try again.",
    };
  }

  const claimed = await db.loginToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!claimed.count) return { error: "This two-factor challenge expired. Sign in again." };

  let next = "/app";
  let authMethod: "password" | "sso" | "magic" | "oauth" | "demo" = "password";
  let ssoConnectionId: string | undefined;
  try {
    const meta = JSON.parse(record.metaJson || "{}") as {
      next?: unknown;
      authMethod?: unknown;
      ssoConnectionId?: unknown;
    };
    next = safeNext(meta.next);
    if (
      typeof meta.authMethod === "string" &&
      ["password", "sso", "magic", "oauth", "demo"].includes(meta.authMethod)
    ) {
      authMethod = meta.authMethod as typeof authMethod;
    }
    if (typeof meta.ssoConnectionId === "string") ssoConnectionId = meta.ssoConnectionId;
  } catch {
    next = "/app";
  }

  const session = await createSession(
    user.id,
    { ip, userAgent: h.get("user-agent") || undefined },
    { authMethod, ssoConnectionId, mfaVerifiedAt: new Date() },
  );
  if (ssoConnectionId) {
    const connection = await db.ssoConnection.findUnique({
      where: { id: ssoConnectionId },
      select: { orgId: true },
    });
    if (connection) {
      await setActiveOrg(connection.orgId).catch(() => null);
    }
  }
  await db.session.update({
    where: { id: session.id },
    data: { lastSeen: new Date() },
  });
  await auditHuman({
    userId: user.id,
    actorName: user.name,
    action: "auth.mfa_verified",
    outcome: "allowed",
    ip,
    payload: { method: result.method },
  });
  redirect(next);
}

export async function verifySessionMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in again." };
  const code = String(formData.get("code") || "").trim();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

  const limit = await consumeRateLimit(`mfa:${session.user.id}:${ip ?? "unknown"}`, 8, 10 * 60_000);
  if (!limit.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const result = await verifySecondFactor(session.user, code);
  if (!result.ok) {
    await auditHuman({
      userId: session.user.id,
      actorName: session.user.name,
      action: "auth.mfa_failed",
      outcome: "denied",
      ip,
      payload: { reason: result.reason, session: session.session.id },
    });
    return {
      error:
        result.reason === "replayed"
          ? "That code was already used. Wait for the next code."
          : "That code is not valid. Check your authenticator and try again.",
    };
  }

  await db.session.update({
    where: { id: session.session.id },
    data: { mfaVerifiedAt: new Date(), lastSeen: new Date() },
  });
  await auditHuman({
    userId: session.user.id,
    actorName: session.user.name,
    action: "auth.mfa_verified",
    outcome: "allowed",
    ip,
    payload: { method: result.method, session: session.session.id },
  });
  redirect("/app");
}
