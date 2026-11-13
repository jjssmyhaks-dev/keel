import { promises as dns } from "node:dns";
import { db } from "./db";
import { randomToken } from "./crypto";
import { RISK_ORDER } from "./consent";

export class ConsentBrandingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConsentBrandingError";
    this.code = code;
  }
}

const LOGO_TYPES: Record<string, { ext: string; magic: (bytes: Uint8Array) => boolean }> = {
  "image/png": {
    ext: "png",
    magic: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  "image/jpeg": {
    ext: "jpg",
    magic: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  "image/webp": {
    ext: "webp",
    magic: (bytes) =>
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
  },
};

export const LOGO_MAX_BYTES = 200 * 1024;

function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((char) => char + char).join("") : match[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]) {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string) {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 0;
  const l1 = luminance(first);
  const l2 = luminance(second);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

export function normalizeHex(value: string, fallback = "#111111") {
  const rgb = parseHex(value);
  if (!rgb) return fallback;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export async function readLogoDataUri(file: File | null) {
  if (!file || !file.size) return undefined;
  if (file.size > LOGO_MAX_BYTES) {
    throw new ConsentBrandingError("logo_too_large", "The logo must be 200KB or smaller.");
  }
  const type = LOGO_TYPES[file.type];
  if (!type) {
    throw new ConsentBrandingError("logo_type", "Upload a PNG, JPEG or WebP logo.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || !type.magic(bytes)) {
    throw new ConsentBrandingError("logo_type", "That file is not a valid PNG, JPEG or WebP image.");
  }
  return `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
}

function absoluteUrl(value: string, field: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConsentBrandingError("invalid_url", `${field} must be an absolute URL.`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConsentBrandingError("invalid_url", `${field} must use HTTPS (HTTP is allowed on localhost).`);
  }
  if (url.username || url.password) {
    throw new ConsentBrandingError("invalid_url", `${field} cannot contain credentials.`);
  }
  return url;
}

export type ConsentBrandingInput = {
  projectId: string;
  productName: string;
  primaryColor: string;
  supportUrl?: string;
  privacyUrl?: string;
  consentText?: string;
  allowedRedirectUris: string[];
  allowedScopes: string[];
  maxRisk: string;
  maxGrantDays: number;
  logoDataUri?: string | null;
  clearLogo?: boolean;
};

/**
 * Validates and stores the hosted-consent branding. The consent-text version
 * only moves when the text actually changes, so an end user's recorded version
 * keeps pointing at the words they saw.
 */
export async function saveConsentBranding(input: ConsentBrandingInput) {
  const productName = input.productName.trim();
  if (!productName) throw new ConsentBrandingError("product_name", "Enter the product name end users will see.");
  if (productName.length > 80) throw new ConsentBrandingError("product_name", "Keep the product name to 80 characters.");

  const primaryColor = normalizeHex(input.primaryColor);
  if (contrastRatio(primaryColor, "#ffffff") < 4.5) {
    throw new ConsentBrandingError(
      "contrast",
      "The accent color must have at least 4.5:1 contrast against white so the approve button stays readable.",
    );
  }

  if (!(RISK_ORDER as string[]).includes(input.maxRisk)) {
    throw new ConsentBrandingError("max_risk", "Choose one of the supported risk ceilings.");
  }
  const maxGrantDays = Math.floor(Number(input.maxGrantDays));
  if (!Number.isFinite(maxGrantDays) || maxGrantDays < 1 || maxGrantDays > 365) {
    throw new ConsentBrandingError("max_grant_days", "Maximum grant length must be between 1 and 365 days.");
  }

  const redirects = [...new Set(input.allowedRedirectUris.map((entry) => entry.trim()).filter(Boolean))];
  if (!redirects.length) throw new ConsentBrandingError("redirects", "Add at least one allowed redirect URI.");
  if (redirects.length > 20) throw new ConsentBrandingError("redirects", "Keep the allowed redirect list to 20 entries.");
  for (const entry of redirects) absoluteUrl(entry, "Redirect URI");

  const scopes = [...new Set(input.allowedScopes.map((entry) => entry.trim()).filter(Boolean))];
  if (!scopes.length) throw new ConsentBrandingError("scopes", "Add at least one allowed scope, or “*” for everything.");
  if (scopes.length > 100) throw new ConsentBrandingError("scopes", "Keep the allowed scope list to 100 entries.");

  const supportUrl = input.supportUrl?.trim() || null;
  const privacyUrl = input.privacyUrl?.trim() || null;
  if (supportUrl) absoluteUrl(supportUrl, "Support URL");
  if (privacyUrl) absoluteUrl(privacyUrl, "Privacy URL");

  const consentText = (input.consentText ?? "").trim().slice(0, 5000);
  if (!consentText) throw new ConsentBrandingError("consent_text", "Write the consent text end users will read.");

  const existing = await db.consentBranding.findUnique({ where: { projectId: input.projectId } });
  const textChanged = existing ? existing.consentText !== consentText : true;
  const consentTextVersion = existing ? existing.consentTextVersion + (textChanged ? 1 : 0) : 1;
  const logoDataUri = input.clearLogo ? null : input.logoDataUri !== undefined ? input.logoDataUri : existing?.logoDataUri ?? null;

  const data = {
    productName,
    primaryColor,
    supportUrl,
    privacyUrl,
    consentText,
    consentTextVersion,
    allowedRedirectUrisJson: JSON.stringify(redirects),
    allowedScopesJson: JSON.stringify(scopes),
    maxRisk: input.maxRisk,
    maxGrantDays,
    logoDataUri,
  };

  return db.consentBranding.upsert({
    where: { projectId: input.projectId },
    create: { projectId: input.projectId, ...data },
    update: data,
  });
}

export function normalizeDomain(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) throw new ConsentBrandingError("domain", "Enter the domain that will host the consent page.");
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConsentBrandingError("domain", "Enter a bare domain like app.example.com.");
  }
  if (!url.hostname.includes(".") || url.hostname === "localhost") {
    throw new ConsentBrandingError("domain", "Enter a public domain like app.example.com.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConsentBrandingError("domain", "Enter only the domain, without a path or query.");
  }
  return url.hostname;
}

export async function startDomainVerification(projectId: string, rawDomain: string) {
  const domain = normalizeDomain(rawDomain);
  const token = `authab-verify=${randomToken(16)}`;
  await db.consentBranding.update({
    where: { projectId },
    data: {
      domainVerificationToken: token,
      // Stored while pending; domainVerifiedAt is the verified marker.
      verifiedDomain: domain,
      domainVerifiedAt: null,
    },
  });
  return { domain, token, recordName: `_authab-verify.${domain}` };
}

export async function verifyConsentDomain(projectId: string) {
  const branding = await db.consentBranding.findUnique({ where: { projectId } });
  if (!branding?.domainVerificationToken || !branding.verifiedDomain) {
    throw new ConsentBrandingError("domain", "Generate a verification record first.");
  }
  const token = branding.domainVerificationToken;
  const domain = normalizeDomain(branding.verifiedDomain);
  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(`_authab-verify.${domain}`);
  } catch {
    throw new ConsentBrandingError(
      "dns",
      `No TXT record found at _authab-verify.${domain} yet. Publish the record and try again — DNS can take a few minutes.`,
    );
  }
  const found = records.some((chunks) => chunks.join("").includes(token));
  if (!found) {
    throw new ConsentBrandingError("dns", `The TXT record at _authab-verify.${domain} does not contain the verification token.`);
  }
  await db.consentBranding.update({
    where: { projectId },
    data: { verifiedDomain: domain, domainVerifiedAt: new Date() },
  });
  return { domain };
}
