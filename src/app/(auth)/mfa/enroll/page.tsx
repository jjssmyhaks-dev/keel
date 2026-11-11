import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateTotpSecret, packMfaSecret, unpackMfaSecret, totpUri } from "@/lib/mfa";
import { EnrollForm, ManageMfa } from "./enroll-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/mfa/enroll");
  const query = await searchParams;

  let user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.deletedAt) redirect("/sign-in");

  const enforcedByOrg = await db.membership.count({
    where: { userId: user.id, status: "active", org: { requireMfa: true, deletedAt: null } },
  });

  if (!user.twoFactorEnabledAt) {
    if (!user.twoFactorSecret || !user.twoFactorDataKey) {
      const generated = generateTotpSecret();
      user = await db.user.update({
        where: { id: user.id },
        data: packMfaSecret(generated, user.id),
      });
    }
    const secret = unpackMfaSecret(user.twoFactorSecret!, user.twoFactorDataKey!, user.id);
    const uri = totpUri({ secret, email: user.email });
    const qrSvg = await QRCode.toString(uri, {
      type: "svg",
      margin: 1,
      width: 200,
      color: { dark: "#111111", light: "#ffffff" },
    });
    return (
      <EnrollForm
        qrSvg={qrSvg}
        secret={secret}
        required={query.required === "1" || enforcedByOrg > 0}
      />
    );
  }

  let recoveryRemaining = 0;
  try {
    recoveryRemaining = (JSON.parse(user.mfaRecoveryCodesJson || "[]") as string[]).length;
  } catch {
    recoveryRemaining = 0;
  }

  return (
    <ManageMfa
      enabledAt={user.twoFactorEnabledAt.toISOString()}
      recoveryRemaining={recoveryRemaining}
      enforced={enforcedByOrg > 0}
    />
  );
}
