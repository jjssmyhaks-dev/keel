"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import {
  ConsentBrandingError,
  readLogoDataUri,
  saveConsentBranding,
  startDomainVerification,
  verifyConsentDomain,
} from "@/lib/consent-branding";

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function saveConsentBrandingAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.can("manage_agents")) redirect("/app/settings/consent?error=permission");

  try {
    const logo = formData.get("logo");
    const logoDataUri = logo instanceof File ? await readLogoDataUri(logo) : undefined;
    await saveConsentBranding({
      projectId: ctx.project.id,
      productName: String(formData.get("productName") ?? ""),
      primaryColor: String(formData.get("primaryColor") ?? ""),
      supportUrl: String(formData.get("supportUrl") ?? ""),
      privacyUrl: String(formData.get("privacyUrl") ?? ""),
      consentText: String(formData.get("consentText") ?? ""),
      allowedRedirectUris: lines(formData.get("redirectUris")),
      allowedScopes: lines(formData.get("allowedScopes")),
      maxRisk: String(formData.get("maxRisk") ?? "write"),
      maxGrantDays: Number(formData.get("maxGrantDays") ?? 90),
      logoDataUri,
      clearLogo: formData.get("clearLogo") === "on",
    });
  } catch (error) {
    if (error instanceof ConsentBrandingError) {
      redirect(`/app/settings/consent?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "config.applied",
    resourceType: "consent_branding",
    resourceId: ctx.project.id,
    outcome: "recorded",
    payloadSummary: { product: ctx.project.name, source: "dashboard" },
  }).catch(() => null);

  revalidatePath("/app/settings/consent");
  redirect("/app/settings/consent?saved=1");
}

export async function domainVerificationAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.can("manage_agents")) redirect("/app/settings/consent?error=permission");
  const intent = String(formData.get("intent") ?? "start");

  try {
    if (intent === "check") {
      const { domain } = await verifyConsentDomain(ctx.project.id);
      revalidatePath("/app/settings/consent");
      redirect(`/app/settings/consent?verified=${encodeURIComponent(domain)}`);
    }
    const result = await startDomainVerification(ctx.project.id, String(formData.get("domain") ?? ""));
    revalidatePath("/app/settings/consent");
    redirect(`/app/settings/consent?record=${encodeURIComponent(result.recordName)}&token=${encodeURIComponent(result.token)}`);
  } catch (error) {
    if (error instanceof ConsentBrandingError) {
      redirect(`/app/settings/consent?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}
