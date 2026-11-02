"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { createSession, destroySession, getSession } from "@/lib/session";
import { provisionOrganization, completeOnboarding } from "@/lib/provisioning";
import { sendEmail, emailLayout, appUrl } from "@/lib/email";
import { auditEvent } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";
import { demoLoginEnabled } from "@/lib/demo";

export type FormState = { error?: string; notice?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function meta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") || undefined,
    device: /mobile|iphone|android/i.test(h.get("user-agent") || "") ? "Mobile browser" : "Web browser",
  };
}

async function issueEmailToken(input: {
  type: string;
  email?: string;
  userId?: string;
  orgId?: string;
  role?: string;
  hours: number;
}) {
  const token = randomToken(32);
  await db.loginToken.create({
    data: {
      tokenHash: sha256(token),
      type: input.type,
      email: input.email?.toLowerCase(),
      userId: input.userId,
      orgId: input.orgId,
      role: input.role,
      expiresAt: new Date(Date.now() + input.hours * 3600_000),
    },
  });
  return token;
}

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  if (/[\\\u0000-\u001f]/.test(next)) return "";
  try {
    const url = new URL(next, "http://keel.local");
    if (url.origin !== "http://keel.local") return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const orgName = String(formData.get("orgName") || "").trim() || `${name.split(" ")[0] || "My"}'s workspace`;
  const next = safeNext(formData.get("next"));

  if (!name || name.length < 2) return { error: "Enter your full name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { error: "Use at least one letter and one number in your password." };
  }

  const m = await meta();
  const limit = await consumeRateLimit(`signup:${m.ip ?? "unknown"}`, 5, 60 * 60_000);
  if (!limit.allowed) return { error: "Too many sign-up attempts. Try again later." };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists. Sign in instead." };
  }

  const user = await db.user.create({
    data: {
      id: crypto.randomUUID(),
      email,
      name,
      passwordHash: hashPassword(password),
    },
  });

  const { org, development } = await provisionOrganization({
    userId: user.id,
    userName: name,
    orgName,
    plan: "free",
    ip: m.ip,
  });

  const token = await issueEmailToken({ type: "email_verify", email, userId: user.id, hours: 48 });
  await sendEmail({
    to: email,
    subject: "Verify your Keel email",
    html: emailLayout(
      "Verify your email",
      `<p>Welcome to Keel, ${name}. Confirm your email address to unlock production mode.</p>
       <p style="margin:24px 0"><a href="${appUrl(`/verify-email?token=${token}`)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Verify email</a></p>
       <p style="color:#8b8b8b;font-size:12px">This link expires in 48 hours. If you didn't create this account, ignore this email.</p>`
    ),
    text: `Verify your Keel email: ${appUrl(`/verify-email?token=${token}`)}`,
  });

  await createSession(user.id, m);
  await auditEvent({
    environmentId: development.id,
    actorType: "human",
    actorId: user.id,
    actorName: name,
    action: "auth.sign_up",
    resourceType: "user",
    resourceId: user.id,
    outcome: "recorded",
    ip: m.ip,
    payloadSummary: { email, org: org.name },
  });
  redirect(next || "/onboarding");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const next = safeNext(formData.get("next"));

  const m = await meta();
  const [perAccount, perIp] = await Promise.all([
    consumeRateLimit(`signin:${m.ip ?? "unknown"}:${email}`, 10, 15 * 60_000),
    consumeRateLimit(`signin-ip:${m.ip ?? "unknown"}`, 40, 15 * 60_000),
  ]);
  if (!perAccount.allowed || !perIp.allowed) {
    return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { error: "Email or password is incorrect." };
  }
  if (email === "demo@keel.dev" && !demoLoginEnabled()) {
    return { error: "Email or password is incorrect." };
  }
  if (user.deletedAt) {
    return { error: "This account is scheduled for deletion. Contact support to restore it." };
  }

  await createSession(user.id, m);
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { lastSeen: new Date() },
  });
  const env = await db.environment.findFirst({
    where: { project: { org: { memberships: { some: { userId: user.id } } } } },
    orderBy: { createdAt: "asc" },
  });
  if (env) {
    await auditEvent({
      environmentId: env.id,
      actorType: "human",
      actorId: user.id,
      actorName: user.name,
      action: "auth.signed_in",
      resourceType: "user",
      resourceId: user.id,
      outcome: "recorded",
      ip: m.ip,
      payloadSummary: { email, method: "password" },
    });
  }

  if (!user.onboardedAt) redirect(next || "/onboarding");
  redirect(next || "/app");
}

export async function signInDemoAction(): Promise<void> {
  if (!demoLoginEnabled()) redirect("/sign-in?notice=demo-disabled");
  const user = await db.user.findUnique({ where: { email: "demo@keel.dev" } });
  if (!user) redirect("/sign-in?notice=demo-unavailable");
  const m = await meta();
  await createSession(user.id, m);
  redirect("/app");
}

export async function requestMagicLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  const m = await meta();
  const limit = await consumeRateLimit(`magic:${m.ip ?? "unknown"}`, 5, 15 * 60_000);
  if (!limit.allowed) return { error: "Too many requests. Wait a few minutes and try again." };

  const user = await db.user.findUnique({ where: { email } });
  if (user && (email !== "demo@keel.dev" || demoLoginEnabled())) {
    const token = await issueEmailToken({ type: "magic_link", email, userId: user.id, hours: 1 });
    await sendEmail({
      to: email,
      subject: "Your Keel sign-in link",
      html: emailLayout(
        "Sign in to Keel",
        `<p>Use the link below to sign in. It expires in one hour and can only be used once.</p>
         <p style="margin:24px 0"><a href="${appUrl(`/auth/magic/${token}`)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Sign in</a></p>
         <p style="color:#8b8b8b;font-size:12px">If you didn't request this, you can ignore it.</p>`
      ),
      text: `Sign in to Keel: ${appUrl(`/auth/magic/${token}`)}`,
    });
  }

  return {
    notice: "If that email has an account, a sign-in link is on its way. It expires in one hour.",
  };
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  const m = await meta();
  const limit = await consumeRateLimit(`reset:${m.ip ?? "unknown"}`, 5, 15 * 60_000);
  if (!limit.allowed) return { error: "Too many requests. Wait a few minutes and try again." };

  const user = await db.user.findUnique({ where: { email } });
  if (user && (email !== "demo@keel.dev" || demoLoginEnabled())) {
    const token = await issueEmailToken({ type: "password_reset", email, userId: user.id, hours: 1 });
    await sendEmail({
      to: email,
      subject: "Reset your Keel password",
      html: emailLayout(
        "Reset your password",
        `<p>We received a request to reset the password for ${email}.</p>
         <p style="margin:24px 0"><a href="${appUrl(`/reset-password?token=${token}`)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Choose a new password</a></p>
         <p style="color:#8b8b8b;font-size:12px">This link expires in one hour and can be used once. If you didn't request it, no action is needed.</p>`
      ),
      text: `Reset your Keel password: ${appUrl(`/reset-password?token=${token}`)}`,
    });
  }

  return { notice: "If an account exists for that email, a reset link has been sent." };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  if (password.length < 10) return { error: "Password must be at least 10 characters." };

  const record = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== "password_reset" || record.usedAt || record.expiresAt < new Date() || !record.userId) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const claimed = await db.loginToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!claimed.count) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(password) } }),
    db.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  redirect("/sign-in?notice=password-reset");
}

export async function verifyEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") || "");
  const record = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== "email_verify" || record.usedAt || record.expiresAt < new Date() || !record.userId) {
    return { error: "This verification link is invalid or has expired." };
  }
  const claimed = await db.loginToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!claimed.count) return { error: "This verification link is invalid or has expired." };
  await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  return { notice: "Email verified. Production mode is now available on a paid plan." };
}

export async function resendVerificationAction(): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Sign in first." };
  if (session.user.emailVerifiedAt) return { notice: "Your email is already verified." };
  const token = await issueEmailToken({
    type: "email_verify",
    email: session.user.email,
    userId: session.user.id,
    hours: 48,
  });
  const delivery = await sendEmail({
    to: session.user.email,
    subject: "Verify your Keel email",
    html: emailLayout(
      "Verify your email",
      `<p><a href="${appUrl(`/verify-email?token=${token}`)}">Confirm your email address</a> to unlock production mode.</p>`
    ),
    text: `Verify your email: ${appUrl(`/verify-email?token=${token}`)}`,
  });
  if (delivery.reason === "console") {
    return { notice: "Email written to the server console. Set RESEND_API_KEY to deliver it." };
  }
  if (!delivery.delivered) {
    return { error: "Email delivery is not configured on this deployment. Ask an operator to set RESEND_API_KEY." };
  }
  return { notice: "Verification email sent." };
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  const store = await cookies();
  store.delete("keel_org");
  store.delete("keel_project");
  store.delete("keel_env");
  redirect("/sign-in");
}

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const workspace = String(formData.get("workspace") || "").trim();
  const projectName = String(formData.get("project") || "").trim();

  const membership = await db.membership.findFirst({
    where: { userId: session.user.id },
    include: { org: { include: { projects: { include: { environments: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    if (workspace && workspace !== membership.org.name) {
      await db.organization.update({
        where: { id: membership.orgId },
        data: { name: workspace, slug: `${workspace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}` },
      });
    }
    const project = membership.org.projects[0];
    if (project && projectName) {
      await db.project.update({ where: { id: project.id }, data: { name: projectName } });
    }
  }

  await completeOnboarding(session.user.id);
  redirect("/app");
}
