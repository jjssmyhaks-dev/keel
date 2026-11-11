import { createSession } from "./session";
import { issueMfaChallenge, mfaRequiredForUser } from "./mfa";

export type LoginMeta = { device?: string; ip?: string; userAgent?: string };

export type LoginOutcome =
  | { kind: "session"; userId: string }
  | { kind: "challenge"; token: string }
  | { kind: "enroll" };

/**
 * Decides what happens after the primary factor succeeds. Accounts with MFA
 * enabled get a single-use challenge instead of a session; organizations that
 * require MFA force enrollment right after the first sign-in.
 */
export async function beginLogin(
  user: { id: string; email: string; twoFactorEnabledAt: Date | null },
  meta: LoginMeta,
  options: {
    next?: string;
    authMethod?: "password" | "sso" | "magic" | "oauth" | "demo";
    ssoConnectionId?: string;
    mfaSatisfied?: boolean;
  } = {},
): Promise<LoginOutcome> {
  const gate = await mfaRequiredForUser(user.id, user.twoFactorEnabledAt);
  if (gate.required && gate.enrolled && !options.mfaSatisfied) {
    const token = await issueMfaChallenge(user.id, user.email, options.next ?? "", {
      authMethod: options.authMethod ?? "password",
      ssoConnectionId: options.ssoConnectionId,
    });
    return { kind: "challenge", token };
  }
  await createSession(user.id, meta, {
    authMethod: options.authMethod ?? "password",
    ssoConnectionId: options.ssoConnectionId,
    mfaVerifiedAt: options.mfaSatisfied || gate.enrolled ? new Date() : null,
  });
  if (gate.required && !gate.enrolled && !options.mfaSatisfied) return { kind: "enroll" };
  return { kind: "session", userId: user.id };
}
